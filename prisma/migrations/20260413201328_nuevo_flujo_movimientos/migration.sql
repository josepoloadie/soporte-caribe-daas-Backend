/*
  Warnings:

  - The values [ABIERTO] on the enum `StatusMovimiento` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "StatusMovimiento_new" AS ENUM ('ENTREGADO', 'INSTALADO', 'EN_ESPERA', 'PENDIENTE_DEVOLUCION', 'CERRADO');
ALTER TABLE "movimientos_componentes" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "movimientos_componentes" ALTER COLUMN "status" TYPE "StatusMovimiento_new" USING ("status"::text::"StatusMovimiento_new");
ALTER TYPE "StatusMovimiento" RENAME TO "StatusMovimiento_old";
ALTER TYPE "StatusMovimiento_new" RENAME TO "StatusMovimiento";
DROP TYPE "StatusMovimiento_old";
ALTER TABLE "movimientos_componentes" ALTER COLUMN "status" SET DEFAULT 'ENTREGADO';
COMMIT;

-- DropForeignKey
ALTER TABLE "movimientos_componentes" DROP CONSTRAINT "movimientos_componentes_componente_id_fkey";

-- AlterTable
ALTER TABLE "movimientos_componentes" ADD COLUMN     "equipo_completo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fecha_entrega" TIMESTAMP(3),
ADD COLUMN     "tecnico" TEXT,
ALTER COLUMN "componente_id" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'ENTREGADO';

-- AddForeignKey
ALTER TABLE "movimientos_componentes" ADD CONSTRAINT "movimientos_componentes_componente_id_fkey" FOREIGN KEY ("componente_id") REFERENCES "componentes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
