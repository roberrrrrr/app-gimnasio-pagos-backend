# Sistema de Gestión de Gimnasios - Backend API

API RESTful para la gestión integral de centros deportivos: control de socios, pagos y reportes financieros.

> **Nota:** Este repositorio contiene el Backend. El Frontend se encuentra en [app-gimnasio-pagos-frontend](https://github.com/roberrrrrr/app-gimnasio-pagos-frontend.git).

---

## Stack Tecnológico

| Componente | Tecnología |
|------------|------------|
| Runtime | Node.js |
| Framework | Express.js |
| Base de Datos | PostgreSQL (Neon - Managed) |
| Despliegue | Render (CI/CD) |
| Lenguaje | JavaScript (ES Modules) |

---

## Requisitos Previos

- **Node.js** v18 o superior
- **PostgreSQL** v14+ (local) o cuenta en [Neon](https://neon.tech)
- **npm** o **yarn**

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/app-gimnasio-pagos-backend.git
cd app-gimnasio-pagos-backend

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tu DATABASE_URL

# 4. Iniciar el servidor
npm start
```

---

## Variables de Entorno

| Variable | Descripción | Requerido |
|----------|-------------|-----------|
| `DATABASE_URL` | Connection string de PostgreSQL | Sí (en producción) |
| `PORT` | Puerto del servidor (default: 3000) | No |

### Ejemplo de `.env`

```env
DATABASE_URL=postgresql://usuario:password@localhost:5432/gimnasio_db
PORT=3000
```

---

## Estructura de la Base de Datos

### Tabla: `clientes`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | Primary key |
| `nombre` | VARCHAR | Nombre del socio |
| `fecha_inscripcion` | TIMESTAMP | Fecha de registro (auto) |

### Tabla: `pagos`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | Primary key |
| `cliente_id` | INTEGER | FK hacia clientes |
| `mes` | VARCHAR | Período (formato: YYYY-MM) |
| `estado` | VARCHAR | 'pagado' o 'pendiente' |
| `monto` | DECIMAL | Cantidad pagada |
| `fecha_pago` | DATE | Fecha de registro del pago |

**Constraint única:** `(cliente_id, mes)` — evita pagos duplicados.

---

## API Endpoints

### Mantenimiento

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/ping` | Health check (mantiene Render activo) |

### Clientes

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/clientes?mes=YYYY-MM` | Lista clientes con estado de pago del mes |
| POST | `/api/clientes` | Crear nuevo socio |
| DELETE | `/api/clientes/:id` | Eliminar socio |

#### GET `/api/clientes?mes=YYYY-MM`

**Respuesta:**

```json
[
  {
    "id": 1,
    "nombre": "Juan Pérez",
    "estado": "pagado",
    "fecha_pago_actual": "2026-04-10",
    "monto": 500,
    "ultimo_pago": "2026-03-05"
  }
]
```

#### POST `/api/clientes`

**Body:**

```json
{ "nombre": "Juan Pérez" }
```

**Respuesta (201):**

```json
{ "id": 1, "nombre": "Juan Pérez", "fecha_inscripcion": "2026-04-10T..." }
```

**Error (400):**

```json
{ "error": "Ya existe un cliente con ese nombre" }
```

### Pagos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/pagos` | Registrar/actualizar pago |

#### POST `/api/pagos`

**Body:**

```json
{
  "cliente_id": 1,
  "mes": "2026-04",
  "monto": 500
}
```

**Respuesta (200):**

```json
{
  "id": 10,
  "cliente_id": 1,
  "mes": "2026-04",
  "estado": "pagado",
  "monto": 500,
  "fecha_pago": "2026-04-10"
}
```

---

## Scripts

| Script | Descripción |
|--------|-------------|
| `npm start` | Inicia el servidor en producción |
| `npm test` | Ejecuta tests (no configurado) |

---

## Funcionalidades

- **Gestión de Socios:** CRUD completo de clientes del gimnasio
- **Control de Pagos:** Registro de pagos mensuales con historial
- **Prevención de Duplicados:** Evita registros de pago duplicados por mes
- **Limpieza Automática:** Elimina pagos con más de 6 meses de antigüedad
- **Health Check:** Endpoint `/ping` para mantener el servicio activo en Render

---

## Desafíos Técnicos

- Diseño y normalización de base de datos relacional para consultas financieras optimizadas
- Pipeline CI/CD con Render para despliegues automáticos
- Control de pagos duplicados mediante constraints únicas
- Balance entre desarrollo local (PostgreSQL) y producción (Neon Managed)

---

## Licencia

ISC
