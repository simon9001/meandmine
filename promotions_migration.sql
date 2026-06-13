-- ============================================================
-- Promotions table — run this in your Supabase SQL editor
-- ============================================================

CREATE TABLE IF NOT EXISTS promotions (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  type             TEXT        NOT NULL CHECK (type IN ('hero_slide', 'navbar_banner')),

  -- Shared fields
  title            TEXT        NOT NULL,
  subtitle         TEXT,
  eyebrow          TEXT,
  offer_text       TEXT,
  cta_text         TEXT        NOT NULL DEFAULT 'Shop Now',
  cta_url          TEXT        NOT NULL,

  -- Hero slide specific
  image_url        TEXT,
  offer_bg         TEXT,                      -- e.g. 'bg-red-500', 'bg-earth-500'

  -- Navbar banner specific
  bg_color         TEXT,                      -- e.g. 'bg-[#0b7a8a]', 'bg-forest-900'
  tags             TEXT[]      DEFAULT '{}',
  offer_badge_style TEXT,                     -- e.g. 'bg-white text-[#0b7a8a]'
  cta_style        TEXT,                      -- e.g. 'bg-[#f5c518] text-black'

  -- Scheduling & ordering
  display_order    INT         DEFAULT 0,
  is_active        BOOLEAN     DEFAULT true,
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Index for the most common public query
CREATE INDEX IF NOT EXISTS idx_promotions_type_active
  ON promotions (type, is_active, display_order);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_promotions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promotions_updated_at ON promotions;
CREATE TRIGGER trg_promotions_updated_at
  BEFORE UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION update_promotions_updated_at();

-- RLS: public read of active, in-window promotions
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active promotions" ON promotions;
CREATE POLICY "Public can read active promotions" ON promotions
  FOR SELECT USING (
    is_active = true
    AND (starts_at IS NULL OR starts_at <= NOW())
    AND (ends_at   IS NULL OR ends_at   >= NOW())
  );

-- ── Seed: Hero Slides ────────────────────────────────────────────────────────

INSERT INTO promotions
  (type, title, subtitle, eyebrow, image_url, offer_text, offer_bg, cta_text, cta_url, display_order)
VALUES
  ('hero_slide', 'Premium Carpets',      'Geometric & abstract styles', 'New Collection',      '/images/carpet-geometric-green.jpeg',      'FROM KES 2,500',  'bg-earth-500',   'Shop Now', '/products?category=carpets',     1),
  ('hero_slide', 'Cookware Sets',        'Mika · Redberry · Rashnik',   'Kitchenware Deals',   '/images/cooking-pots.jpeg',                'UP TO 40% OFF',   'bg-red-500',     'Shop Now', '/products?category=kitchenware', 2),
  ('hero_slide', 'Bed Canopies & Nets',  'Princess · Four-post · Ceiling','Bedroom Essentials', '/images/canopy-princess-purple.jpeg',      'FROM KES 1,800',  'bg-forest-600',  'Shop Now', '/products?category=bedding',     3),
  ('hero_slide', 'Hot & Cold Dispensers','Sonar · Ailyons · Signature', 'Appliances Week',     '/images/water-dispenser-red.jpeg',         'UP TO 30% OFF',   'bg-red-500',     'Shop Now', '/products?category=appliances',  4),
  ('hero_slide', 'Home Décor',           'Cushions · Contact paper · More','Style Your Space',  '/images/cushion-tribal-black-white.jpeg',  'FROM KES 450',    'bg-earth-600',   'Shop Now', '/products?category=home-decor',  5);

-- ── Seed: Navbar Banners ─────────────────────────────────────────────────────

INSERT INTO promotions
  (type, title, tags, offer_text, offer_badge_style, cta_text, cta_style, cta_url, bg_color, display_order)
VALUES
  ('navbar_banner', 'Kitchenware Deals', ARRAY['Redberry','Mika','Rashnik','Selven'],                'UP TO 40% OFF',        'bg-white text-[#0b7a8a]',  'SHOP NOW', 'bg-[#f5c518] text-black',   '/products?category=kitchenware', 'bg-[#0b7a8a]',   1),
  ('navbar_banner', 'Home Textiles',     ARRAY['Carpets','Canopies','Curtains','Cushions'],          'FROM KES 980',         'bg-white text-forest-900', 'SHOP NOW', 'bg-earth-500 text-white',   '/products?category=carpets',     'bg-forest-900',  2),
  ('navbar_banner', 'Appliances Week',   ARRAY['Hisense','Ecomax','Syinix','Sonar'],                 'UP TO 30% OFF',        'bg-white text-[#1a4fa0]',  'SHOP NOW', 'bg-[#f5c518] text-black',   '/products?category=appliances',  'bg-[#1a4fa0]',   3),
  ('navbar_banner', 'Storage & Home',    ARRAY['Wardrobes','Shoe Racks','Drying Racks','Organizers'],'PRICES FROM KES 450',  'bg-white text-earth-800',  'SHOP NOW', 'bg-[#f5c518] text-black',   '/products?category=storage',     'bg-earth-800',   4),
  ('navbar_banner', 'Fast Delivery',     ARRAY['Nairobi Same Day','Nationwide 2–4 Days','M-Pesa','Cash on Delivery'],'FREE DELIVERY KES 3,000+','bg-earth-400 text-white','ORDER NOW','bg-white text-forest-900','/products',  'bg-[#1a3828]',   5);


