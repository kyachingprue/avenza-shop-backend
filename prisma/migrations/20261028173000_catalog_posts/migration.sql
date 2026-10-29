CREATE TABLE "CatalogPost" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "postData" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogPost_slug_key" ON "CatalogPost"("slug");
