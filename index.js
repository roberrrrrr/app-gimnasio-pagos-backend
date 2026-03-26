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
    await limpiarPagosViejos(); // Limpiamos la BD antes de consultar

    const mesSolicitado = req.query.mes;
    if (!mesSolicitado) return res.status(400).json({ error: "Falta el mes" });

    // Calculamos el mes real de HOY en la vida real (ej: "2026-03")
    const fechaHoy = new Date();
    const mesReal = `${fechaHoy.getFullYear()}-${(fechaHoy.getMonth() + 1).toString().padStart(2, "0")}`;

    // --- REGLA 1: EL FUTURO ---
    if (mesSolicitado > mesReal) {
      return res.json([]);
    }

    // --- REGLA 2: EL PASADO Y PRESENTE ---
    // Agregamos las fechas de pago actuales y pasadas al SELECT
    const query = `
      SELECT 
        c.id, 
        c.nombre, 
        COALESCE(p.estado, 'pendiente') as estado,
        p.fecha_pago as fecha_pago_actual,
        (SELECT MAX(fecha_pago) FROM pagos p2 WHERE p2.cliente_id = c.id AND p2.mes < $1) as ultimo_pago
      FROM clientes c
      LEFT JOIN pagos p ON c.id = p.cliente_id AND p.mes = $1
      WHERE TO_CHAR(c.fecha_inscripcion, 'YYYY-MM') <= $1
      ORDER BY c.id DESC
    `;
    const resultado = await pool.query(query, [mesSolicitado]);

    res.json(resultado.rows);
  } catch (error) {
    console.error("Error en la consulta GET:", error);
    res.status(500).json({ error: "Error al obtener clientes" });
  }
});

// 2. AGREGAR un cliente nuevo (Evita duplicados)
app.post("/api/clientes", async (req, res) => {
  try {
    const { nombre } = req.body;

    // 1. Limpiamos espacios extra al principio y al final
    const nombreLimpio = nombre.trim();

    // 2. Buscamos si ya existe alguien con ese nombre (ILIKE ignora mayúsculas/minúsculas)
    const busqueda = await pool.query(
      "SELECT * FROM clientes WHERE nombre ILIKE $1",
      [nombreLimpio],
    );

    if (busqueda.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "Ya existe un cliente con ese nombre" });
    }

    // 3. Si no existe, lo insertamos normal
    const query = "INSERT INTO clientes (nombre) VALUES ($1) RETURNING *";
    const resultado = await pool.query(query, [nombreLimpio]);

    res.json(resultado.rows[0]);
  } catch (error) {
    console.error("Error al crear cliente:", error);
    res.status(500).json({ error: "Error al crear cliente" });
  }
});

// 3. REGISTRAR UN PAGO (Ahora guarda el día exacto con CURRENT_DATE)
app.post("/api/pagos", async (req, res) => {
  try {
    const { cliente_id, mes } = req.body;
    // Agregamos fecha_pago = CURRENT_DATE tanto al insertar como al actualizar
    const query = `
      INSERT INTO pagos (cliente_id, mes, estado, fecha_pago) 
      VALUES ($1, $2, 'pagado', CURRENT_DATE)
      ON CONFLICT (cliente_id, mes) DO UPDATE 
      SET estado = 'pagado', fecha_pago = CURRENT_DATE
      RETURNING *
    `;
    const resultado = await pool.query(query, [cliente_id, mes]);
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error("Error al registrar pago:", error);
    res.status(500).json({ error: "Error al registrar pago" });
  }
});

// 4. ELIMINAR un cliente
app.delete("/api/clientes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM clientes WHERE id = $1", [id]);
    res.json({ mensaje: "Cliente eliminado" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar cliente" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
