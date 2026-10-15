# SmartStock Pro

Appli de gestion de stock et de caisse (un seul fichier : `index.html`) + base Supabase.

## 1. Supabase (une seule fois)
1. Ouvre ton projet sur Supabase → SQL Editor → colle `supabase/schema.sql` → Run.
2. Déploie les fonctions `signup-patron`, `create-employee`, `delete-employee`, `initiate-payment` depuis `supabase/functions/`.
3. Configure les variables d’environnement Supabase requises. Ne publie jamais la clé `service_role`.

## 2. GitHub Pages
Dans Settings → Pages, sélectionne `main` et `/ (root)` après l’ajout de `index.html`.

⚠️ Le paiement mobile n’est pas encore configuré dans `initiate-payment`.