# Vérification de connexion par e-mail — Smart Stock Pro 2

À chaque connexion cloud et au premier accès après inscription Patron, un code unique à six chiffres est envoyé à l'adresse e-mail enregistrée. Aucun code SMS n'est envoyé ou demandé.

## Fournisseur et secrets
Utiliser Resend avec un domaine d'envoi vérifié. Configurer dans Supabase Edge Function Secrets :
- `RESEND_API_KEY`
- `OTP_EMAIL_FROM` (ex. `Smart Stock Pro <verification@votre-domaine.com>`)
Les variables `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont fournies par Supabase. Ne jamais exposer la clé service-role.

## Déploiement
1. Appliquer `supabase/migrations/202611180001_login_otp.sql` après le schéma de base et les migrations multi-rôles.
2. Déployer `send-login-otp`, `verify-login-otp`, `bind-login-otp`.
3. Déployer les versions mises à jour de `signup-patron`, `create-employee` et `delete-employee`.
4. Garder `verify_jwt = false` pour l'émission et la vérification du code; `bind-login-otp` conserve `verify_jwt = true`.

## Données et sécurité
- Patron : e-mail obligatoire à l'inscription.
- Employé : e-mail obligatoire à la création du compte. Le téléphone peut rester facultatif comme simple contact.
- Les anciens comptes doivent avoir un e-mail valide.
- Code à six chiffres, expiration cinq minutes, une demande par minute, cinq essais maximum; seul le hachage salé est stocké.
- Le défi est lié à l'identifiant exact de la session Supabase. Les contrôles RLS refusent l'accès cloud aux sessions non vérifiées.
- Aucun compte Twilio, secret SMS ou numéro international n'est requis.

## Tests avant production
Tester Patron, gestionnaire, vendeur et caissier : réception e-mail, code erroné, expiration, limite d'essais, limitation de renvoi et blocage du tableau de bord avant validation. La vérification n'est pas active en production tant que migration, fonctions, secrets et tests réels ne sont pas terminés.
