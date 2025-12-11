#!/usr/bin/env node

import { writeFileSync, readFileSync } from "fs";
import { resolve } from "path";

/**
 * Automated Contract Data Sync
 * Downloads latest contract data from PACT broker and updates test file
 */

const PACT_BROKER_URL = "https://ffc-pact-broker.azure.defra.cloud";
const PACT_URL = `${PACT_BROKER_URL}/pacts/provider/fg-gas-backend-sns/consumer/farming-grants-agreements-api-sqs/latest`;
const TEST_FILE_PATH = resolve(process.cwd(), "test/contract/provider.sns.verification.test.js");

export async function syncContractData() {
  try {
    console.log("🔄 Syncing contract data from PACT broker...");
    console.log(`📥 Fetching: ${PACT_URL}`);

    // Fetch latest contract from PACT broker
    const response = await fetch(PACT_URL, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.PACT_USER}:${process.env.PACT_PASS}`).toString('base64')}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch contract: ${response.status} ${response.statusText}`);
    }

    const pact = await response.json();
    console.log(`✅ Downloaded pact version: ${pact.consumer.name} v${pact.consumer.version || 'latest'}`);

    // Debug: Log the actual pact structure
    console.log("📋 Pact structure:", {
      interactions: pact.interactions?.length || 0,
      messages: pact.messages?.length || 0,
      keys: Object.keys(pact)
    });

    // Handle different PACT formats
    const interactions = pact.interactions || pact.messages || [];
    
    console.log(`📋 Found ${interactions.length} interactions:`);
    
    const contractData = {};
    interactions.forEach(interaction => {
      const messageName = interaction.description;
      // Try different ways to get the message content
      const messageContent = interaction.response?.contents || 
                           interaction.contents || 
                           interaction.response?.body ||
                           interaction.body;
      
      console.log(`   - ${messageName}:`, messageContent ? "✅ Content found" : "❌ No content");
      if (messageContent) {
        contractData[messageName] = messageContent;
      }
    });

    // Generate updated test constants
    const updatedConstants = generateTestConstants(contractData);
    
    // Read current test file
    const currentTestFile = readFileSync(TEST_FILE_PATH, 'utf8');
    
    // Update the contract data in the test file
    const updatedTestFile = updateTestFileWithNewData(currentTestFile, updatedConstants);
    
    // Write updated file
    writeFileSync(TEST_FILE_PATH, updatedTestFile);
    
    // Save raw contract data for reference
    const contractDataPath = resolve(process.cwd(), "test/contract/contract-data.json");
    writeFileSync(contractDataPath, JSON.stringify({
      lastUpdated: new Date().toISOString(),
      source: PACT_URL,
      pactVersion: pact.consumer.version || 'latest',
      contractData
    }, null, 2));

    console.log("✅ Contract data synchronized successfully!");
    console.log(`📝 Updated: ${TEST_FILE_PATH}`);
    console.log(`📄 Saved reference: ${contractDataPath}`);
    console.log("\n🔬 Run the test to verify the updated data:");
    console.log("   npx vitest test/contract/provider.sns.verification.test.js --run");

  } catch (error) {
    console.error("❌ Failed to sync contract data:", error.message);
    process.exit(1);
  }
}

function generateTestConstants(contractData) {
  let constants = "";
  
  // Use fixed variable names that match what the test expects
  const messageMap = {
    "an agreement created message": "agreementCreatedMessage",
    "an agreement withdrawn message": "agreementWithdrawnMessage"
  };
  
  Object.entries(contractData).forEach(([messageName, content]) => {
    const variableName = messageMap[messageName] || messageName.replace(/[^a-zA-Z0-9]/g, '');
    
    constants += `
// ${messageName} (Auto-generated from PACT broker)
const ${variableName} = ${JSON.stringify(content, null, 2)};
`;
  });
  
  return constants;
}

function updateTestFileWithNewData(currentContent, newConstants) {
  // Find the auto-generated contract data section
  const startMarker = "// Contract data auto-generated from PACT broker";
  const endMarker = "let agreementCreatedMessage;";
  
  let startIndex = currentContent.indexOf(startMarker);
  let endIndex = currentContent.indexOf(endMarker);
  
  if (startIndex === -1 || endIndex === -1) {
    console.warn("⚠️  Could not find contract data section in test file");
    console.log("📝 Please manually update the contract constants in the test file");
    console.log("🔍 Looking for markers:");
    console.log(`   Start: "${startMarker}" (found: ${startIndex !== -1})`);
    console.log(`   End: "${endMarker}" (found: ${endIndex !== -1})`);
    return currentContent;
  }
  
  // Replace the section between markers with new constants
  const before = currentContent.substring(0, startIndex);
  const after = currentContent.substring(endIndex);
  
  const updated = before + 
    `// Contract data auto-generated from PACT broker on ${new Date().toISOString()}\n` +
    `// Source: ${PACT_URL}\n` + 
    newConstants + 
    "\n" + after;
  
  return updated;
}

// Load environment from .env.test if available
import { existsSync } from "fs";
if (existsSync(".env.test")) {
  process.loadEnvFile(".env.test");
}

// Check for required environment variables
if (!process.env.PACT_USER || !process.env.PACT_PASS) {
  console.error("❌ Missing required environment variables:");
  process.exit(1);
}

// Run the sync if this file is executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  syncContractData();
}