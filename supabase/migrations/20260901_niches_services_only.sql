-- Sagitário: modelo simplificado de dois níveis (nicho -> serviço).
-- Esta migração é idempotente e não apaga a tabela legada categories.

DO $$
DECLARE
  niche_id_type text;
BEGIN
  IF to_regclass('public.niches') IS NULL OR to_regclass('public.services') IS NULL THEN
    RAISE EXCEPTION 'As tabelas public.niches e public.services precisam existir antes da migração.';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod)
    INTO niche_id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'niches'
    AND a.attname = 'id'
    AND a.attisdropped = false;

  IF niche_id_type IS NULL THEN
    RAISE EXCEPTION 'Não foi possível identificar o tipo de public.niches.id.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'services'
      AND a.attname = 'niche_id'
      AND a.attisdropped = false
  ) THEN
    EXECUTE format('ALTER TABLE public.services ADD COLUMN niche_id %s', niche_id_type);
  END IF;
END $$;

-- If an old categories.niche_id relation exists, preserve it while moving the
-- service directly to the niche. On the current project categories is global,
-- so this block simply does nothing there.
DO $$
DECLARE
  service_category_column text;
  category_id_column text;
  category_niche_column text;
BEGIN
  IF to_regclass('public.categories') IS NULL THEN
    RETURN;
  END IF;

  SELECT a.attname INTO service_category_column
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'services'
    AND a.attname IN ('category_id', 'categoria_id')
    AND a.attisdropped = false
  ORDER BY a.attnum
  LIMIT 1;

  SELECT a.attname INTO category_id_column
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'categories'
    AND a.attname IN ('id', 'uuid', 'category_id', 'categoria_id')
    AND a.attisdropped = false
  ORDER BY a.attnum
  LIMIT 1;

  SELECT a.attname INTO category_niche_column
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'categories'
    AND a.attname IN ('niche_id', 'nicho_id', 'segment_id')
    AND a.attisdropped = false
  ORDER BY a.attnum
  LIMIT 1;

  IF service_category_column IS NOT NULL
     AND category_id_column IS NOT NULL
     AND category_niche_column IS NOT NULL THEN
    EXECUTE format(
      'UPDATE public.services AS s
          SET niche_id = c.%I
        FROM public.categories AS c
       WHERE s.%I = c.%I
         AND s.niche_id IS NULL',
      category_niche_column, service_category_column, category_id_column
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS services_niche_id_idx ON public.services (niche_id);

-- Add referential integrity when the existing id types and data allow it.
-- Orphaned legacy rows are left untouched for manual review instead of being
-- deleted or assigned to an arbitrary niche.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.services'::regclass
      AND conname = 'services_niche_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.services
        ADD CONSTRAINT services_niche_id_fkey
        FOREIGN KEY (niche_id) REFERENCES public.niches(id)
        ON UPDATE CASCADE ON DELETE RESTRICT;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'A chave estrangeira services_niche_id_fkey não foi criada automaticamente: %', SQLERRM;
    END;
  END IF;
END $$;

-- An empty or fully assigned table becomes strictly two-level. If old rows are
-- still NULL, review/assign them first and rerun this statement.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.services WHERE niche_id IS NULL) THEN
    ALTER TABLE public.services ALTER COLUMN niche_id SET NOT NULL;
  END IF;
END $$;

-- categories is intentionally retained as a compatibility table. The
-- application no longer reads or writes it, which avoids breaking proposals,
-- plans, or historical foreign keys that may still reference old records.
