import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  // En tu compu usa tus datos, pero en internet usa la URL de Neon
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres:TU_PASSWORD@localhost:5432/gimnasio_db",
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});
// FUNCIÓN: Limpiar datos más viejos de 6 meses
const limpiarPagosViejos = async () => {
  const hace6Meses = new Date();
  hace6Meses.setMonth(hace6Meses.getMonth() - 6);
  const mesLimite = `${hace6Meses.getFullYear()}-${(hace6Meses.getMonth() + 1).toString().padStart(2, "0")}`;

  await pool.query("DELETE FROM pagos WHERE mes < $1", [mesLimite]);
};

// AUTO-MIGRACIÓN: deja el esquema al día en cada arranque.
// Todo es idempotente: correr esto 100 veces no rompe ni duplica nada.
const inicializarBase = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Migración 1 (histórica): columna de baja lógica. Queda por compatibilidad,
    // pero a partir de ahora la fuente de verdad son los ciclos (socios_ciclos).
    await client.query(
      "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS fecha_baja TIMESTAMP",
    );

    // Migración 2: modelo de periodos. Cada fila es una etapa de socio.
    // fecha_fin NULL = ciclo abierto (socio activo hoy).
    await client.query(`
      CREATE TABLE IF NOT EXISTS socios_ciclos (
        id           SERIAL PRIMARY KEY,
        cliente_id   INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        fecha_inicio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        fecha_fin    TIMESTAMP,
        CONSTRAINT chk_ciclo_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
      )
    `);

    // Un cliente no puede tener dos ciclos abiertos a la vez (regla de negocio en la DB).
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ciclo_abierto_por_cliente
        ON socios_ciclos (cliente_id)
        WHERE fecha_fin IS NULL
    `);

    // Índice para el EXISTS del listado mes a mes (cubre abiertos y cerrados).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_socios_ciclos_cliente
        ON socios_ciclos (cliente_id)
    `);

    // Backfill idempotente: crea un ciclo por cada cliente que todavía no tenga ninguno.
    // Mapea el esquema viejo: inscripción -> inicio, baja -> fin (NULL = sigue activo).
    await client.query(`
      INSERT INTO socios_ciclos (cliente_id, fecha_inicio, fecha_fin)
      SELECT c.id, COALESCE(c.fecha_inscripcion, c.fecha_baja, CURRENT_TIMESTAMP), c.fecha_baja
      FROM clientes c
      WHERE NOT EXISTS (
        SELECT 1 FROM socios_ciclos sc WHERE sc.cliente_id = c.id
      )
    `);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// 0. RUTA PING (Mantiene SOLO a Render despierto para no gastar horas de Neon)
app.get("/ping", (req, res) => {
  res.status(200).send("Render despierto 🏋️‍♂️");
});

// 0. RUTA PING (Mantiene a Render Y a Neon despiertos)
//app.get("/ping", async (req, res) => {
//  try {
//    // Le hacemos la consulta más mínima posible a Neon para que no se duerma
//    await pool.query("SELECT 1");
//    res
//      .status(200)
//      .send("Render y Neon están despiertos y listos para entrenar 🏋️‍♂️");
//  } catch (error) {
//    console.error("Error en el ping:", error);
//    res.status(500).send("Error al despertar la base de datos");
//  }
//});

// 1. OBTENER clientes y su estado en un mes específico (AHORA CON FECHAS DE PAGO)
app.get("/api/clientes", async (req, res) => {
  try {
    await limpiarPagosViejos();
    const mesSolicitado = req.query.mes;
    if (!mesSolicitado) return res.status(400).json({ error: "Falta el mes" });

    const fechaHoy = new Date();
    const mesReal = `${fechaHoy.getFullYear()}-${(fechaHoy.getMonth() + 1).toString().padStart(2, "0")}`;

    if (mesSolicitado > mesReal) return res.json([]);

    // Agregamos p.monto al SELECT
    const query = `
      SELECT 
        c.id, 
        c.nombre, 
        COALESCE(p.estado, 'pendiente') as estado,
        p.fecha_pago as fecha_pago_actual,
        p.monto,
        (SELECT MAX(fecha_pago) FROM pagos p2 WHERE p2.cliente_id = c.id AND p2.mes < $1) as ultimo_pago
      FROM clientes c
      LEFT JOIN pagos p ON c.id = p.cliente_id AND p.mes = $1
      -- El cliente aparece en el mes M si algún ciclo (etapa) cubrió ese mes.
      -- Funciona con cualquier cantidad de altas/bajas/reactivaciones.
      WHERE EXISTS (
        SELECT 1 FROM socios_ciclos sc
        WHERE sc.cliente_id = c.id
          AND TO_CHAR(sc.fecha_inicio, 'YYYY-MM') <= $1
          AND (sc.fecha_fin IS NULL OR TO_CHAR(sc.fecha_fin, 'YYYY-MM') > $1)
      )
      ORDER BY c.id DESC
    `;
    const resultado = await pool.query(query, [mesSolicitado]);
    res.json(resultado.rows);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener clientes" });
  }
});

// 2. AGREGAR un cliente nuevo (o detectar que existe dado de baja para reactivar)
app.post("/api/clientes", async (req, res) => {
  const client = await pool.connect();
  try {
    const { nombre } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: "El nombre es obligatorio" });
    }
    const nombreLimpio = nombre.trim();

    await client.query("BEGIN");

    // ¿Ya existe alguien con ese nombre? (ILIKE ignora mayúsculas/minúsculas)
    const busqueda = await client.query(
      "SELECT id, nombre FROM clientes WHERE nombre ILIKE $1",
      [nombreLimpio],
    );

    if (busqueda.rows.length > 0) {
      const existente = busqueda.rows[0];

      // ¿Tiene un ciclo abierto? -> está activo, es un duplicado real.
      const cicloAbierto = await client.query(
        "SELECT 1 FROM socios_ciclos WHERE cliente_id = $1 AND fecha_fin IS NULL LIMIT 1",
        [existente.id],
      );

      await client.query("ROLLBACK");

      if (cicloAbierto.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "Ya existe un cliente con ese nombre" });
      }

      // Está dado de baja: no es error, requiere confirmación del usuario.
      return res.status(409).json({
        error: "Existe un cliente dado de baja con ese nombre",
        requiereConfirmacion: true,
        cliente: { id: existente.id, nombre: existente.nombre },
      });
    }

    // Cliente nuevo: creamos la ficha Y su primer ciclo, en la misma transacción.
    const nuevo = await client.query(
      "INSERT INTO clientes (nombre) VALUES ($1) RETURNING *",
      [nombreLimpio],
    );
    await client.query(
      "INSERT INTO socios_ciclos (cliente_id, fecha_inicio) VALUES ($1, CURRENT_TIMESTAMP)",
      [nuevo.rows[0].id],
    );

    await client.query("COMMIT");
    res.json(nuevo.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error al crear cliente:", error);
    res.status(500).json({ error: "Error al crear cliente" });
  } finally {
    client.release();
  }
});

// 3. REGISTRAR UN PAGO (Ahora guarda el día exacto con CURRENT_DATE)
app.post("/api/pagos", async (req, res) => {
  try {
    const { cliente_id, mes, monto } = req.body;

    // Insertamos o actualizamos incluyendo el monto
    const query = `
      INSERT INTO pagos (cliente_id, mes, estado, fecha_pago, monto) 
      VALUES ($1, $2, 'pagado', CURRENT_DATE, $3)
      ON CONFLICT (cliente_id, mes) DO UPDATE 
      SET estado = 'pagado', monto = $3 
      RETURNING *
    `;
    const resultado = await pool.query(query, [cliente_id, mes, monto || 0]);
    res.json(resultado.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Error al registrar pago" });
  }
});

// 4. DAR DE BAJA un cliente (cierra su ciclo abierto: conserva todo el historial)
app.delete("/api/clientes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await pool.query(
      "UPDATE socios_ciclos SET fecha_fin = CURRENT_TIMESTAMP WHERE cliente_id = $1 AND fecha_fin IS NULL RETURNING *",
      [id],
    );

    if (resultado.rowCount === 0) {
      return res
        .status(404)
        .json({ error: "Cliente no encontrado o ya dado de baja" });
    }

    res.json({ mensaje: "Cliente dado de baja" });
  } catch (error) {
    console.error("Error al dar de baja cliente:", error);
    res.status(500).json({ error: "Error al dar de baja cliente" });
  }
});

// 5. REACTIVAR un cliente dado de baja (abre un ciclo nuevo, conserva los anteriores)
app.put("/api/clientes/:id/reactivar", async (req, res) => {
  try {
    const { id } = req.params;

    const existe = await pool.query(
      "SELECT id, nombre FROM clientes WHERE id = $1",
      [id],
    );
    if (existe.rows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }

    // El índice único parcial impide dos ciclos abiertos: si ya está activo, falla.
    await pool.query(
      "INSERT INTO socios_ciclos (cliente_id, fecha_inicio) VALUES ($1, CURRENT_TIMESTAMP)",
      [id],
    );

    res.json({ mensaje: "Cliente reactivado", cliente: existe.rows[0] });
  } catch (error) {
    // 23505 = unique_violation (el cliente ya tenía un ciclo abierto)
    if (error.code === "23505") {
      return res.status(400).json({ error: "El cliente ya está activo" });
    }
    console.error("Error al reactivar cliente:", error);
    res.status(500).json({ error: "Error al reactivar cliente" });
  }
});

const PORT = process.env.PORT || 3000;

inicializarBase()
  .then(() => {
    app.listen(PORT, () =>
      console.log(`Servidor corriendo en puerto ${PORT}`),
    );
  })
  .catch((error) => {
    console.error("Error al inicializar la base de datos:", error);
    process.exit(1);
  });
