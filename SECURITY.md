# Security Policy

## Supported versions

Security fixes are provided for the latest released version.

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| Earlier versions | No |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting from the repository's **Security** tab:

<https://github.com/fsioni/my-garage-map/security/advisories/new>

Include:

- the affected version or commit;
- the operating system and Node.js version;
- a clear description of the impact;
- minimal reproduction steps or a proof of concept;
- any suggested remediation;
- whether the report contains personal data.

Remove real vehicle data, VINs, registration numbers, document paths, and database contents
unless they are essential to the report. If the private reporting form is unavailable, contact
the maintainer through the contact method published on the
[`fsioni` GitHub profile](https://github.com/fsioni) and request a private channel.

The maintainer will make a best effort to acknowledge complete reports within seven days, keep
the reporter informed, and coordinate disclosure after a fix is available.

## Security boundaries

Garage MCP is a local, single-user stdio server. It does not provide authentication, network
isolation, sandboxing, or multi-user authorization. Anyone who can invoke the configured MCP
server can act with that server process's permissions and access its garage database.

Document attachments are references to local paths; the application does not upload or copy
the referenced files. Configure `GARAGE_DOCUMENT_ROOT` to restrict accepted paths. Keep the
database and document directory protected with operating-system permissions, and do not expose
the stdio process through an untrusted bridge.
