# Sistema de Gestión de Gimnasios - Backend API ⚙️🗄️

API RESTful y gestión de base de datos para la solución integral de administración de centros deportivos.

> 🔗 **Nota:** Este repositorio contiene el Backend. El código del Frontend (Interfaz de Usuario) se encuentra en [https://github.com/roberrrrrr/app-gimnasio-pagos-frontend.git].

### 🌟 Arquitectura y Características
- **API REST:** Endpoints seguros para la gestión de socios, pagos y reportes financieros.
- **Persistencia de Datos:** Almacenamiento relacional asegurando la integridad de las transacciones y control de pagos duplicados.
- **Tracking Financiero:** Lógica de negocio para calcular recaudación acumulada y estados de cuenta.

### 🛠️ Stack Tecnológico (Backend)
- **Entorno:** Node.js + Express.js.
- **Base de Datos:** PostgreSQL (Managed vía Neon).
- **Despliegue:** Render (CI/CD configurado).

### 🧠 Desafíos Técnicos Superados
- Diseño y normalización de la base de datos relacional para optimizar las consultas financieras.
- Implementación de un pipeline de despliegue continuo (CI/CD) para integraciones ágiles.
