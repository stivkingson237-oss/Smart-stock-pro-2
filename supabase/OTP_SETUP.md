# Activation de la double vérification OTP (e-mail + SMS)

Cette fonctionnalité envoie deux codes distincts de six chiffres à chaque connexion cloud et avant le premier accès du nouveau compte Patron au tableau de bord.

## Fournisseurs requis

- E-mail : compte Resend avec domaine d'envoi vérifié.
- SMS : compte Twilio, expéditeur SMS autorisé et destination Cameroun activée dans les permissions géographiques.

Au Cameroun, Twilio indique que les Sender IDs alphanumériques doivent être pré-enregistrés pour le trafic international. Le réseau MTN ne prend pas en charge les expéditeurs numériques internationaux. Vérifier la livraison réelle sur MTN et Orange avant lancement général.

## Secrets Supabase Edge Functions

Dans Supabase > Project Settings > Edge Functions > Secrets, configurer :

- `RESEND_API_KEY`
- `OTP_EMAIL_FROM` (ex. `Smart Stock Pro <verification@votre-domaine.com>`, domaine validé chez Resend)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM` (expéditeur autorisé, idéalement Sender ID alphanumérique enregistré)

Les variables `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont celles du runtime Supabase. Ne jamais exposer la clé service-role dans le navigateur ou dans GitHub.

## Migration et fonctions à déployer

1. Exécuter `supabase/migrations/202611180001_login_otp.sql` dans le SQL Editor du projet Supabase.
2. Déployer les Edge Functions `send-login-otp`, `verify-login-otp` et `bind-login-otp`.
3. Déployer aussi les mises à jour de `signup-patron` et `create-employee`.
4. Vérifier `verify_jwt = false` pour les deux fonctions OTP. L'authentification du compte est vérifiée côté serveur avant l'émission des codes.

## Données obligatoires

- Patron : adresse e-mail et téléphone sont obligatoires à l'inscription. Le téléphone est normalisé avec l'indicatif du pays.
- Employé : le Patron doit enregistrer une adresse e-mail et un téléphone au format E.164 (ex. `+2376XXXXXXXX`) lors de la création du compte employé.
- Les anciens comptes doivent disposer de coordonnées valides avant de pouvoir utiliser la double vérification.

## Contrôles de sécurité

- Codes e-mail et SMS distincts, valides cinq minutes.
- Une seule demande par compte toutes les 60 secondes.
- Maximum cinq essais par défi.
- Codes stockés sous forme de hachages salés par défi.
- Le défi OTP est lié à l’identifiant de session Supabase exact après validation.
- Les fonctions RLS `is_member`, `is_owner` et `can_access_boutique` refusent l’accès cloud aux sessions non liées à un défi OTP vérifié.
- Aucun accès au tableau de bord cloud avant validation des deux codes.
- Les clés fournisseurs restent dans les secrets Supabase.

## Test avant production

Tester un Patron et chaque rôle employé, avec des numéros MTN et Orange consentants. Vérifier réception, expiration, code erroné, limite d'essais, limitation de renvoi et absence d'accès au tableau de bord avant validation. Ne pas activer la production tant que l'envoi SMS réel n'a pas été confirmé.
