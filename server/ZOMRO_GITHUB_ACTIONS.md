# Zomro VPS: initial GitHub Actions setup

The Zomro frontend workflow is **inactive until** four environment secrets are set.
It deploys only the frontend to /var/www/planer, leaving /opt/planer-api/data and the trading bot untouched.

## One-time setup

1. Create a dedicated unprivileged SSH account for deployment on the VPS (do not use root in GitHub Actions).
2. Grant that account write access only to /opt/planer-source, /var/www/planer and /opt/planer-backups, and permission to run npm/git. Do not grant it database or unrelated service access. Confirm the existing site owner and permissions before changing ownership.
3. Generate a dedicated ed25519 SSH keypair **on a trusted device**; install only the public key in the deployment account's ~/.ssh/authorized_keys (chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys). Do not post the private key in chat or commit it to Git.
4. Verify the VPS SSH host public key fingerprint out-of-band against the server's /etc/ssh/ssh_host_ed25519_key.pub; obtain the matching known_hosts line securely.
5. In GitHub repository Settings > Environments create environment `zomro-production`. Add environment secrets:
   - `ZOMRO_SSH_HOST`: VPS public host/IP
   - `ZOMRO_SSH_USER`: dedicated deployment account
   - `ZOMRO_SSH_PRIVATE_KEY`: private SSH key (entire contents)
   - `ZOMRO_SSH_KNOWN_HOSTS`: verified SSH known_hosts entry for the VPS
6. Test via Actions > Deploy Planner frontend to Zomro VPS > Run workflow. Check that version.json and /api/health are correct.

## Safety

The workflow first waits for successful main-branch GitHub Pages checks, then builds on VPS, backs up the previous website, and publishes only the frontend. It does not migrate or restart the API. API changes require a separate reviewed deployment procedure.

For rollback, identify the latest site backup under /opt/planer-backups and restore only its contents to /var/www/planer. Never restore or overwrite the SQLite database as part of frontend rollback.
