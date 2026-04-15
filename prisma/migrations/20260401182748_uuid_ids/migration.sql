-- CreateEnum
CREATE TYPE "TipoEquipo" AS ENUM ('LAPTOP', 'DESKTOP', 'AIO');

-- CreateEnum
CREATE TYPE "EstadoEquipo" AS ENUM ('COMPLETO', 'CON_FALLAS', 'INCOMPLETO', 'PRESTADO', 'PENDIENTE_REPOSICION', 'BAJA');

-- CreateEnum
CREATE TYPE "CategoriaComponente" AS ENUM ('SSD', 'RAM', 'PANTALLA', 'BATERIA', 'BOARD', 'TECLADO', 'OTRO');

-- CreateEnum
CREATE TYPE "EstadoComponente" AS ENUM ('BUENO', 'DANADO', 'EN_USO', 'EN_REVISION', 'PENDIENTE_DEVOLUCION', 'PENDIENTE_REPOSICION');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('INSTALACION', 'RETIRO', 'DEVOLUCION', 'REEMPLAZO', 'INGRESO');

-- CreateEnum
CREATE TYPE "UsoTipo" AS ENUM ('TEMPORAL', 'DEFINITIVO', 'NA');

-- CreateEnum
CREATE TYPE "StatusMovimiento" AS ENUM ('ABIERTO', 'CERRADO');

-- CreateEnum
CREATE TYPE "EstadoRepuesto" AS ENUM ('EN_CAMINO', 'EN_TRANSITO', 'RECIBIDO', 'INSTALADO');

-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('ADMIN', 'TECNICO');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL DEFAULT 'TECNICO',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipos" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "product_number" TEXT,
    "tipo_equipo" "TipoEquipo" NOT NULL,
    "cliente" TEXT,
    "estado" "EstadoEquipo" NOT NULL DEFAULT 'COMPLETO',
    "observaciones" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_original" (
    "id" TEXT NOT NULL,
    "equipo_id" TEXT NOT NULL,
    "fecha_consulta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_data" JSONB,

    CONSTRAINT "configuracion_original_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_original_detalle" (
    "id" TEXT NOT NULL,
    "configuracion_id" TEXT NOT NULL,
    "part_number" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "categoria" "CategoriaComponente",

    CONSTRAINT "configuracion_original_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "componentes" (
    "id" TEXT NOT NULL,
    "part_number" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "categoria" "CategoriaComponente" NOT NULL,
    "ct" TEXT,
    "estado" "EstadoComponente" NOT NULL DEFAULT 'BUENO',
    "equipo_actual_id" TEXT,
    "observaciones" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "componentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_componentes" (
    "id" TEXT NOT NULL,
    "componente_id" TEXT NOT NULL,
    "numero_caso" TEXT NOT NULL,
    "tipo_movimiento" "TipoMovimiento" NOT NULL,
    "origen_id" TEXT,
    "destino_id" TEXT,
    "uso_tipo" "UsoTipo" NOT NULL DEFAULT 'NA',
    "ct_malo" TEXT,
    "ct_bueno" TEXT,
    "fecha_instalacion" TIMESTAMP(3),
    "fecha_devolucion" TIMESTAMP(3),
    "status" "StatusMovimiento" NOT NULL DEFAULT 'ABIERTO',
    "usuario_id" TEXT NOT NULL,
    "observaciones" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_componentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repuestos_hp" (
    "id" TEXT NOT NULL,
    "numero_caso" TEXT NOT NULL,
    "equipo_destino_id" TEXT,
    "componente_id" TEXT,
    "part_number" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" "EstadoRepuesto" NOT NULL DEFAULT 'EN_CAMINO',
    "fecha_recepcion" TIMESTAMP(3),
    "fecha_instalacion" TIMESTAMP(3),
    "observaciones" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repuestos_hp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "equipos_serial_key" ON "equipos"("serial");

-- AddForeignKey
ALTER TABLE "configuracion_original" ADD CONSTRAINT "configuracion_original_equipo_id_fkey" FOREIGN KEY ("equipo_id") REFERENCES "equipos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracion_original_detalle" ADD CONSTRAINT "configuracion_original_detalle_configuracion_id_fkey" FOREIGN KEY ("configuracion_id") REFERENCES "configuracion_original"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "componentes" ADD CONSTRAINT "componentes_equipo_actual_id_fkey" FOREIGN KEY ("equipo_actual_id") REFERENCES "equipos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_componentes" ADD CONSTRAINT "movimientos_componentes_componente_id_fkey" FOREIGN KEY ("componente_id") REFERENCES "componentes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_componentes" ADD CONSTRAINT "movimientos_componentes_origen_id_fkey" FOREIGN KEY ("origen_id") REFERENCES "equipos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_componentes" ADD CONSTRAINT "movimientos_componentes_destino_id_fkey" FOREIGN KEY ("destino_id") REFERENCES "equipos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_componentes" ADD CONSTRAINT "movimientos_componentes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repuestos_hp" ADD CONSTRAINT "repuestos_hp_equipo_destino_id_fkey" FOREIGN KEY ("equipo_destino_id") REFERENCES "equipos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repuestos_hp" ADD CONSTRAINT "repuestos_hp_componente_id_fkey" FOREIGN KEY ("componente_id") REFERENCES "componentes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
