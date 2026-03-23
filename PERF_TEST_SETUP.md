# Performance Test Data Seeding

## ⚠️ WARNING

This branch is **ONLY** for performance testing environments. **DO NOT MERGE TO MAIN**.

## Overview

This hotfix branch contains a special migration that clears and seeds performance test data for load testing consistency.

## Branch Strategy

- **Branch name**: `hotfix/perf-test-seed`
- **Purpose**: Deploy to test environment via hotfix workflow
- **Lifecycle**: Keep updated via periodic rebases with main
- **Merge policy**: **NEVER merge to main**

## How It Works

### Migration: `99999999999999-perf-test-seed.js`

- **Timestamp**: Far-future (99999999999999) to ensure it runs last
- **Safety**: Requires `PERF_TEST_SEED=true` environment variable
- **Actions**:
  1. Clears all data from: applications, application_series, outbox, inbox
  2. Seeds 100 test applications with consistent data
  3. Creates test application series

### npm Script

```bash
npm run migrate:perf-test
```

Automatically sets `PERF_TEST_SEED=true` and runs the migration.

## Data Structure

### Generated Test Data

- **Applications**: 100 test applications
- **Client Refs**: `perf-test-000` to `perf-test-099`
- **Grant Code**: `frps-private-beta`
- **Status**: `APPLICATION_RECEIVED`
- **Identifiers**: Sequential SBI, FRN, CRN numbers

### Example Application

```javascript
{
  _id: "app-id-perf-test-000",
  code: "frps-private-beta",
  clientRef: "perf-test-000",
  currentPhase: "PRE_AWARD",
  currentStage: "REVIEW_APPLICATION",
  currentStatus: "APPLICATION_RECEIVED",
  identifiers: {
    sbi: "107000000",
    frn: "1100000000",
    crn: "1100000000"
  },
  // ... additional fields
}
```

## Deployment Process

### 1. Create/Update Branch

```bash
# First time
git checkout -b hotfix/perf-test-seed

# Add the migration and npm script (already done)
git add migrations/99999999999999-perf-test-seed.js package.json
git commit -m "perf: add performance test data seeding migration"
git push origin hotfix/perf-test-seed
```

### 2. Periodic Rebase (Keep Updated)

```bash
# Pull latest main
git checkout main
git pull origin main

# Rebase hotfix branch
git checkout hotfix/perf-test-seed
git rebase main

# Resolve conflicts if any (should be minimal)
# The migration file should rarely conflict

# Force push (safe for hotfix branch that's not merged)
git push origin hotfix/perf-test-seed --force
```

### 3. Deploy via Hotfix Workflow

1. Go to GitHub Actions
2. Select **"Publish Hot Fix"** workflow
3. Click **"Run workflow"**
4. Select branch: `hotfix/perf-test-seed`
5. Click **"Run workflow"**

The workflow will:

- Run tests
- Build the service
- Deploy to test environment
- Migrations will run automatically (including perf-test-seed)

### 4. Verify Deployment

```bash
# Connect to test environment and check data
# (Use appropriate kubectl/mongo client commands for your environment)

# Check application count
db.applications.countDocuments({ clientRef: /^perf-test-/ })
# Expected: 100

# Check first few test applications
db.applications.find({ clientRef: /^perf-test-/ }).limit(5)
```

## Environment Variables

The migration checks for `PERF_TEST_SEED=true`. In the deployment environment:

- **Local Testing**: Set in your terminal
- **CI/CD**: Script automatically sets it
- **Production**: Never set (migration skips automatically)

## Safety Features

1. **Explicit Opt-in**: Requires `PERF_TEST_SEED=true`
2. **Skip by Default**: Will not run in normal deployments
3. **Clear Logging**: Shows exactly what will be deleted/created
4. **Rollback Support**: Includes `down()` migration to remove test data

## Customizing Test Data

### Modify Application Count

Edit `migrations/99999999999999-perf-test-seed.js`:

```javascript
// Change this line:
for (let i = 0; i < 100; i++) {
// To generate more/fewer applications:
for (let i = 0; i < 500; i++) {  // 500 applications
```

### Modify Application Structure

Edit the `testApplications.push()` section to add/modify fields:

```javascript
testApplications.push({
  // ... existing fields
  answers: {
    eligibility: "yes",
    landArea: 100 + i,
    // Add more test answers here:
    cropType: "wheat",
    organicCertified: i % 2 === 0, // Alternating true/false
  },
});
```

After changes, commit and push:

```bash
git add migrations/99999999999999-perf-test-seed.js
git commit -m "perf: update test data structure"
git push origin hotfix/perf-test-seed
```

## Rebase Conflict Resolution

When rebasing with main, conflicts are unlikely but may occur in:

### package.json

If there are new scripts added to main:

```bash
# Accept both changes
# Your script should be:
"migrate:perf-test": "PERF_TEST_SEED=true migrate-mongo up"
```

### Migration File

Very unlikely to conflict (timestamp 99999999999999 is far in the future).
If somehow it does:

```bash
git checkout --ours migrations/99999999999999-perf-test-seed.js
git add migrations/99999999999999-perf-test-seed.js
git rebase --continue
```

## Testing Locally

### Prerequisites

- MongoDB running locally
- `.env` file configured

### Run the Migration

```bash
# Set environment variable and run
npm run migrate:perf-test
```

### Expected Output

```
🧹 Starting performance test data seeding...
⚠️  This will CLEAR ALL DATA in the following collections:
   - applications
   - application_series
   - grants (will re-populate from migrations)
   - outbox
   - inbox

🗑️  Clearing collections...
   ✓ Cleared applications
   ✓ Cleared application_series
   ✓ Cleared outbox
   ✓ Cleared inbox

📝 Seeding test data...
   ✓ Inserted 100 test applications
   ✓ Inserted 100 test application series

✅ Performance test data seeding complete!
   Total applications: 100
   Client refs: perf-test-000 to perf-test-099
```

### Verify Locally

```bash
# Connect to your local MongoDB
mongosh

# Switch to database
use fg-gas-backend

# Check applications
db.applications.countDocuments({ clientRef: /^perf-test-/ })

# View sample data
db.applications.findOne({ clientRef: "perf-test-000" })
```

### Rollback Locally

```bash
migrate-mongo down
```

## Integration with fg-cw-backend

The `fg-cw-backend` repository has a matching migration that:

- Creates cases with matching `caseRef` values
- Uses same client refs: `perf-test-000` to `perf-test-099`
- Ensures GAS applications and CW cases are synchronized

Deploy both hotfix branches to ensure consistency:

1. Deploy `fg-gas-backend/hotfix/perf-test-seed`
2. Deploy `fg-cw-backend/hotfix/perf-test-seed`

## Troubleshooting

### Migration Doesn't Run

**Check**: Is `PERF_TEST_SEED=true` set?

```bash
echo $PERF_TEST_SEED
# Should output: true
```

### Data Already Exists

The migration clears data first, so existing data is removed.
If you want to preserve data, **do not run this migration**.

### Wrong Environment

If you accidentally deployed to the wrong environment:

```bash
# Run rollback migration
migrate-mongo down
```

Or manually delete test data:

```javascript
db.applications.deleteMany({ clientRef: /^perf-test-/ });
db.application_series.deleteMany({ clientRefs: /^perf-test-/ });
```

## Best Practices

1. **Always rebase before deploying**: Keep the branch up-to-date with main
2. **Test locally first**: Verify the migration works before deploying
3. **Document changes**: Update this README if you modify test data structure
4. **Coordinate deployments**: Deploy GAS and CW branches together for consistency
5. **Never merge**: This branch should never be merged to main

## FAQ

**Q: Why use a far-future timestamp (99999999999999)?**
A: Ensures this migration always runs last, after all production migrations.

**Q: Can I add this to CI/CD automatically?**
A: No, this requires manual trigger via hotfix workflow for safety.

**Q: What if I need different test data for different test runs?**
A: Modify the migration, commit, and redeploy. Or create multiple versions.

**Q: Is this approach safe?**
A: Yes, with proper safeguards:

- Environment variable guard
- Isolated test environment
- Manual deployment only
- Clear logging

---

**Created**: 2026-03-18
**Branch**: hotfix/perf-test-seed
**Purpose**: Performance testing data seeding
**Maintenance**: Rebase periodically with main
