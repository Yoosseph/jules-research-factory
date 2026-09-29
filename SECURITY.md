# Security policy

Research Facility runs on the local loopback interface and handles Jules and GitHub credentials. Treat `.env.local`, `.env`, and the entire `.data/` directory as sensitive. The database and its encryption key must remain together; encryption does not protect against someone who obtains both files.

## Supported version

Security fixes target the latest version on `main`.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** option in the repository's Security tab. Include the affected version, steps to reproduce, and the likely impact. Do not post a working exploit or credentials in a public issue. If that option is unavailable, open a public issue requesting a private contact method without including vulnerability details.

You can expect an acknowledgment within seven days. We will coordinate a fix and disclosure timeline with the reporter.
