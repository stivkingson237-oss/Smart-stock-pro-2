# Activation de la double vérification OTP (e-mail + SMS)

Cette fonctionnalité envoie deux codes distincts de six chiffres à chaque connexion cloud et avant le premier accès du nouveau compte Patron au tableau de bord.

## Fournisseurs requis

- E-mail : compte Resend avec domaine d'envoi vérifié.
- SMS : compte Twilio, expéditeur SMS autorisé et destination Cameroun activée dans les permissions géographiques.

Pour le Cameroun, Twilio indique que les Sender IDs alphanumériques doivent être pré-enregistrés à l'international (délai indicatif publié : environ trois semaines). Le réseau MTN ne prend pas en charge les expéditeurs numériques internationaux. Valider la livraison réelle sur MTN et Orange avant lancement général.

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
2. Déployer les Edge Functions `send-login-otp` et `verify-login-otp`.
3. Vérifier que `verify_jwt = false` est configuré pour ces deux fonctions : elles authentifient le compte par identifiant/mot de passe avant de créer le défi OTP, puis valident les deux codes côté serveur.
4. Déployer aussi les mises à jour de `signup-patron` et `create-employee` afin que les coordonnées réelles soient stockées pour l'envoi.

## Données obligatoires

- Patron : adresse e-mail et téléphone international sont obligatoires à l'inscription. Le téléphone est normalisé avec l'indicatif du pays.
- Employé : le Patron doit enregistrer une adresse e-mail et un téléphone au format E.164 (ex. `+2376XXXXXXXX`) lors de la création du compte employé.
- Les anciens comptes sans coordonnées valides doivent être mis à jour avant de pouvoir utiliser la double vérification.

## Contrôles de sécurité

- Codes e-mail et SMS distincts, valides cinq minutes.
- Une seule demande par compte toutes les 60 secondes.
- Maximum cinq essais de vérification par défi.
- Les codes ne sont pas stockés en clair en base.
- Aucun accès au tableau de bord cloud avant validation des deux codes.
- Les clés fournisseurs restent dans les secrets Supabase.

## Test avant production

Tester séparément un Patron et chaque rôle employé, avec des numéros MTN et Orange réels consentants. Vérifier réception, expiration, code erroné, limite d'essais, limitation de renvoi et absence d'accès au tableau de bord avant validation. Ne pas activer la production tant que l'envoi SMS réel n'a pas été confirmé.
