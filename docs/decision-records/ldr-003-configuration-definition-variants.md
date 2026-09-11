# Lightweight Decision Record - Configuration Definition Variants

|                  |                                                      |
| ---------------- | ---------------------------------------------------- |
| status           | proposed                                             |
| date             | 10 Sep 2026                                          |
| decision makers  | Core Grants Team                                     |
| people consulted | Core Grants Team, Grants UI Team, Config Broker Team |
| people informed  | Core Grants Team, Grants UI Team, Config Broker Team |

## Context and Problem Statement

Grant configuration releases contain definitions consumed by GAS and Caseworking. Teams need to develop future Grant, Agreement, Payment and Workflow definitions in lower environments while continuing to change and release the files used by production.

Config Broker publishes a versioned manifest containing every file in a grant configuration release. It does not select files for individual environments and will not be changed for this requirement. GAS and Caseworking currently select fixed filenames from the manifest, persist their S3 locations, and lazily cache the definitions by code and semantic configuration version.

We need to let lower environments select an alternative, internally consistent set of definitions without allowing production to use that set and without changing the existing cache identities.

## Decision Drivers

- **Parallel delivery**: development of future definitions must not block production configuration releases.
- **Production safety**: production must always select the existing unsuffixed files.
- **No Config Broker change**: selection must be owned by GAS and Caseworking.
- **Backward compatibility**: existing manifests and environment configuration must continue to work unchanged.
- **Consistent definitions**: a consumer must not silently mix suffixed and unsuffixed definitions.
- **Cache safety**: immutable semantic configuration versions must remain the identity used by the lazy caches.
- **Future flexibility**: lower environments may need to select different alternatives later.

## Considered Options

### 1. Use separate semantic version lines

Maintain production and development definitions on different semantic version lines and use Config Broker release status and environment targeting to control availability.

Good, because a semantic configuration version continues to identify the same content in every environment.

Good, because Config Broker already supports environment-specific release status.

Bad, because production fixes would need to be maintained on an older release line while future work continued on another line.

Bad, because this adds branching and hotfix-release overhead to routine configuration changes.

### 2. Select variants in Config Broker

Make Config Broker choose an environment-specific source file and publish only that location to consumers.

Good, because selection would happen once and GAS and Caseworking could not disagree.

Bad, because Config Broker cannot be changed for this requirement.

### 3. Store variants in separate folders

Place complete alternatives under variant-specific directories and make each consumer select a directory.

Good, because all files for one alternative are grouped together.

Good, because adding more alternatives or definition types would not lengthen filenames.

Bad, because it introduces a larger change to the established grant configuration layout and promotion process.

### 4. Select configurable filename variants in each consumer

Keep the existing unsuffixed files and add alternatives by inserting a configured value before `.json`. GAS and Caseworking independently select matching files from the manifest.

Good, because Config Broker already uploads the files and includes them in the manifest, so it remains unchanged.

Good, because an unset setting preserves existing behaviour.

Good, because the configured value is not tied to a particular environment and can differ between lower environments later.

Bad, because GAS and Caseworking must be configured consistently in each environment.

Bad, because complete definition files are duplicated and production changes must also be applied to relevant variants.

Bad, because the same semantic configuration version can resolve to different content in different environments.

## Decision Outcome

Option 4 - configurable filename variants selected by GAS and Caseworking.

GAS and Caseworking will expose an optional `CONFIGURATION_VARIANT` setting. When it is unset or empty, they will select the existing filenames:

```text
gas/gas.json
gas/agreement.json
gas/payment.json
cw/cw.json
```

When it contains a valid value, each consumer will insert that value before `.json`. For example, `CONFIGURATION_VARIANT=next` selects:

```text
gas/gas.next.json
gas/agreement.next.json
gas/payment.next.json
cw/cw.next.json
```

Variant values are lowercase letters, numbers and hyphens. The value is configuration rather than a fixed environment name. Lower environments opt in independently, and GAS and Caseworking in the same environment must use the same value.

GAS selects the Grant definition and any Agreement and Payment definitions. Caseworking selects the Workflow definition. Each service persists its selected S3 locations in its existing config-version catalogue before the first lazy fetch.

A configured consumer does not silently fall back to an unsuffixed definition. An Agreement or Payment definition may remain absent when neither form exists, because those definition types are optional.

Production always selects the unsuffixed files. If a variant is configured with `ENVIRONMENT=prod`, the service logs a warning, ignores the value and continues using the unsuffixed files.

## Cache and Release Rules

The variant does not become part of a cache key or persisted domain identity. Grant, Agreement, Payment and Workflow definitions remain identified by their code and semantic configuration version.

A service selects and stores an S3 location when it processes a Config Broker notification. After the first use, the definition may exist in a MongoDB cache and, for some definition types, an in-process cache. Changing only `CONFIGURATION_VARIANT` cannot reliably replace those cached definitions.

A new semantic configuration version is therefore required whenever variant content changes or an environment changes the variant it selects. Existing semantic configuration versions are not changed in place.

Promotion consists of copying the approved variant content into the corresponding unsuffixed files and publishing a new semantic configuration version. Production never selects a suffixed file directly.

## Consequences

Config Broker requires no code or contract changes.

GAS and Caseworking gain equivalent manifest-selection behaviour and environment configuration. Their settings must be kept aligned operationally.

Existing environments remain backward compatible because the setting is optional and the unsuffixed filenames do not change.

Configuration maintainers must keep production fixes and active variants synchronised where appropriate. Full-file duplication and manual promotion are accepted as short-term operational costs.

The same semantic configuration version can represent different definition content across environments. Diagnostics must therefore include the selected S3 location and configured variant.

The current lazy-cache design remains unchanged, but switching an existing cached semantic version between variants is unsupported.

## More Information

Delivery ticket: [FGP-1413 - GAS/CW: Support configurable definition variants](https://eaflood.atlassian.net/browse/FGP-1413).
