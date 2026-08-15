# Security Policy

## Reporting A Vulnerability

Please open a private security advisory in the repository rather than a public issue. Include the affected version, reproduction steps, impact, and any suggested mitigation.

## Secrets

Never commit API keys, signing secrets, environment files, databases, logs, or generated media. If a secret is committed or displayed in a log, revoke it at the provider and issue a replacement. Removing it from the latest commit is not sufficient.

## Deployment

OpenFlow forwards credentials supplied by the browser to user-selected API endpoints. Public or shared deployments should add access control, rate limits, request size limits, HTTPS, and network egress restrictions appropriate to their environment.

Use a unique, randomly generated `REFERENCE_UPLOAD_SECRET` for every deployment. Do not reuse authentication or provider credentials as the upload signing secret.
