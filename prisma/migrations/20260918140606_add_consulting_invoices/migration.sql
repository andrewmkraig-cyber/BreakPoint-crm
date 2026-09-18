-- CreateTable
CREATE TABLE "consulting_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "invoiceNumber" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "servicePeriodStart" TIMESTAMP(3),
    "servicePeriodEnd" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "emailedFrom" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consulting_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consulting_invoices_organizationId_invoiceDate_idx" ON "consulting_invoices"("organizationId", "invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "consulting_invoices_organizationId_company_invoiceNumber_key" ON "consulting_invoices"("organizationId", "company", "invoiceNumber");

-- AddForeignKey
ALTER TABLE "consulting_invoices" ADD CONSTRAINT "consulting_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

