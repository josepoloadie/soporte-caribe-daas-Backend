-- CreateTable
CREATE TABLE "historial_ct" (
    "id" TEXT NOT NULL,
    "componente_id" TEXT NOT NULL,
    "ct" TEXT NOT NULL,
    "motivo" TEXT,
    "movimiento_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_ct_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "historial_ct" ADD CONSTRAINT "historial_ct_componente_id_fkey" FOREIGN KEY ("componente_id") REFERENCES "componentes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
