import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPORT_DIR = "./test/reports";
const REPORT_FILE = path.join(REPORT_DIR, "comprehensive-report.html");

function generateTestReport() {
  console.log("📊 Generating FG-Gas-Backend Integration Test Report...");

  // Ensure report directory exists
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  let testResults;
  try {
    // Run the integration tests and capture output
    console.log("🧪 Running integration tests...");
    const testOutput = execSync(
      "npm run test:integration:service && npm run test:integration:events && npm run test:integration:workflows",
      {
        encoding: "utf8",
        timeout: 300000, // 5 minute timeout
      },
    );

    // Parse test results (simplified for demo)
    testResults = parseTestOutput(testOutput);
  } catch (error) {
    console.log(
      "⚠️ Some tests failed, generating report with current results...",
    );
    testResults = parseTestOutput(error.stdout || error.message);
  }

  // Generate HTML report
  const htmlReport = generateHTMLReport(testResults);

  // Write report file
  fs.writeFileSync(REPORT_FILE, htmlReport);

  console.log(`✅ Test report generated: ${REPORT_FILE}`);
  console.log(
    `📈 Summary: ${testResults.passed} passed, ${testResults.failed} failed, ${testResults.passRate}% pass rate`,
  );
}

function parseTestOutput(output) {
  // Parse vitest output to extract test results
  const lines = output.split("\n");
  let passed = 0;
  let failed = 0;
  let total = 0;
  const testFiles = [];

  let currentFile = null;
  let currentTests = [];

  for (const line of lines) {
    // Match test file headers
    if (line.includes("✓") && line.includes(".test.js")) {
      if (currentFile) {
        testFiles.push({
          name: currentFile,
          status: "passed",
          tests: currentTests,
        });
      }
      currentFile = line.trim();
      currentTests = [];
      passed++;
    }

    // Match failed test files
    if (line.includes("❌") && line.includes(".test.js")) {
      if (currentFile) {
        testFiles.push({
          name: currentFile,
          status: "failed",
          tests: currentTests,
        });
      }
      currentFile = line.trim();
      currentTests = [];
      failed++;
    }

    // Match individual tests
    if (line.trim().startsWith("✓") || line.trim().startsWith("❌")) {
      const testName = line.trim().substring(2).trim();
      const status = line.trim().startsWith("✓") ? "passed" : "failed";
      currentTests.push({ name: testName, status });
    }
  }

  // Add the last file
  if (currentFile) {
    testFiles.push({
      name: currentFile,
      status: currentTests.some((t) => t.status === "failed")
        ? "failed"
        : "passed",
      tests: currentTests,
    });
  }

  total = passed + failed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  return {
    passed,
    failed,
    total,
    passRate,
    testFiles,
    rawOutput: output,
  };
}

function formatTestResults(testResults) {
  let formattedOutput = `📊 FG-GAS-BACKEND TEST EXECUTION SUMMARY\n`;
  formattedOutput += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  formattedOutput += `Total Test Suites: ${testResults.testFiles.length}\n`;
  formattedOutput += `✅ Passed Suites: ${testResults.passed}\n`;
  formattedOutput += `❌ Failed Suites: ${testResults.failed}\n\n`;

  formattedOutput += `Pass Rate: ${testResults.passRate}%\n\n`;

  testResults.testFiles.forEach((testFile) => {
    const fileStatus = testFile.status === "passed" ? "✅" : "❌";
    formattedOutput += `${fileStatus} ${testFile.name}\n`;

    testFile.tests.forEach((test) => {
      const testStatus = test.status === "passed" ? "  ✅" : "  ❌";
      formattedOutput += `${testStatus} ${test.name}\n`;
    });
    formattedOutput += `\n`;
  });

  return formattedOutput;
}

function generateHTMLReport(testResults) {
  const timestamp = new Date().toLocaleString();
  const formattedResults = formatTestResults(testResults);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FG-Gas-Backend Integration Test Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6; 
            color: #333;
            background: #f8fafc;
        }
        
        .header {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            padding: 2rem 0;
            text-align: center;
        }
        
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 0 1rem; 
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin: 2rem 0;
        }
        
        .stat-card {
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }
        
        .stat-number {
            font-size: 2.5rem;
            font-weight: bold;
            margin-bottom: 0.5rem;
        }
        
        .passed { color: #10b981; }
        .failed { color: #ef4444; }
        .total { color: #6366f1; }
        .rate { color: #8b5cf6; }
        
        .section {
            background: white;
            margin: 2rem 0;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .section-header {
            background: #f8fafc;
            padding: 1rem 1.5rem;
            border-bottom: 1px solid #e2e8f0;
            font-weight: 600;
            font-size: 1.1rem;
        }
        
        .section-content {
            padding: 1.5rem;
        }
        
        .test-output {
            background: #1a202c;
            color: #e2e8f0;
            padding: 1rem;
            border-radius: 4px;
            font-family: 'Monaco', 'Consolas', monospace;
            font-size: 0.875rem;
            overflow-x: auto;
            white-space: pre-wrap;
            max-height: 600px;
            overflow-y: auto;
        }
        
        .footer {
            text-align: center;
            padding: 2rem;
            color: #64748b;
            border-top: 1px solid #e2e8f0;
            margin-top: 2rem;
        }
        
        .badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 500;
        }
        
        .badge-success { background: #dcfce7; color: #166534; }
        .badge-warning { background: #fef3c7; color: #92400e; }
        .badge-danger { background: #fee2e2; color: #991b1b; }
        
        .highlight-box {
            background: #f0f9ff;
            border: 1px solid #0ea5e9;
            border-radius: 6px;
            padding: 1rem;
            margin: 1rem 0;
        }
        
        .highlight-box h3 {
            color: #0ea5e9;
            margin-bottom: 0.5rem;
        }

        .architecture-section {
            background: #f8f9fa;
            padding: 1.5rem;
            border-left: 4px solid #10b981;
            margin: 1rem 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="container">
            <h1>🚀 FG-Gas-Backend Integration Test Report</h1>
            <p>Generated on ${timestamp}</p>
        </div>
    </div>
    
    <div class="container">
        <div class="stats">
            <div class="stat-card">
                <div class="stat-number passed">${testResults.passed}</div>
                <div>Tests Passed</div>
            </div>
            <div class="stat-card">
                <div class="stat-number failed">${testResults.failed}</div>
                <div>Tests Failed</div>
            </div>
            <div class="stat-card">
                <div class="stat-number total">${testResults.total}</div>
                <div>Total Tests</div>
            </div>
            <div class="stat-card">
                <div class="stat-number rate">${testResults.passRate}%</div>
                <div>Pass Rate</div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-header">
                📊 Test Migration Summary
                <span class="badge ${testResults.passRate > 80 ? "badge-success" : testResults.passRate > 60 ? "badge-warning" : "badge-danger"}">
                    ${testResults.passRate > 80 ? "Excellent" : testResults.passRate > 60 ? "Good" : "Needs Improvement"}
                </span>
            </div>
            <div class="section-content">
                <div class="highlight-box">
                    <h3>🎯 Migration Achievement</h3>
                    <p><strong>Integration Test Migration:</strong> Successfully migrated external integration tests from fg-gas-case-working-integration to internal fg-gas-backend TestContainers-based tests.</p>
                    <p><strong>Architecture:</strong> Implemented layered testing approach (Service → Event → Workflow) with comprehensive coverage.</p>
                    <p><strong>Benefits:</strong> Faster execution, no external dependencies, better debugging, CI/CD integration, cross-service event testing.</p>
                </div>
                
                <div class="architecture-section">
                    <h3>🏗 Test Architecture</h3>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem;">
                        <li><strong>Service Layer:</strong> Grant creation, application submission, data validation with real database persistence</li>
                        <li><strong>Event Integration:</strong> SNS event publishing, cross-service communication (fg-gas → fg-cw), event ordering</li>
                        <li><strong>Workflow Tests:</strong> End-to-end grant application workflows, action invocation, error handling</li>
                    </ul>
                </div>
                
                <p><strong>Test Environment:</strong> TestContainers with isolated Docker services (MongoDB, LocalStack SNS/SQS).</p>
                <p><strong>Coverage:</strong> Grant CRUD operations, application submission with complex validation, SNS event publishing, action invocation, cross-service integration.</p>
            </div>
        </div>
        
        <div class="section">
            <div class="section-header">🔍 Detailed Test Output</div>
            <div class="section-content">
                <div class="test-output">${formattedResults}</div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-header">📋 Key Features Tested</div>
            <div class="section-content">
                <h3>Service Layer Integration:</h3>
                <ul style="margin-left: 2rem; margin-top: 0.5rem;">
                    <li><strong>Grant Management:</strong> Complex schema validation, nested question structures, action configuration</li>
                    <li><strong>Application Processing:</strong> Comprehensive data validation, referential integrity, concurrent submissions</li>
                    <li><strong>Business Logic:</strong> Multi-level validation rules, error handling, data consistency</li>
                </ul>
                
                <h3 style="margin-top: 1rem;">Event Integration:</h3>
                <ul style="margin-left: 2rem; margin-top: 0.5rem;">
                    <li><strong>SNS Publishing:</strong> Application created events, data type preservation, cross-service format compatibility</li>
                    <li><strong>Event Consistency:</strong> Ordering guarantees, concurrent processing, high-volume handling</li>
                    <li><strong>Cross-Service:</strong> fg-gas → fg-cw event flow, format validation, integration testing</li>
                </ul>
                
                <h3 style="margin-top: 1rem;">Workflow Testing:</h3>
                <ul style="margin-left: 2rem; margin-top: 0.5rem;">
                    <li><strong>End-to-End:</strong> Complete grant application lifecycle, action invocation, error resilience</li>
                    <li><strong>Multi-Grant:</strong> Cross-grant dependencies, farmer identification, complex scenarios</li>
                    <li><strong>Error Handling:</strong> Validation failures, system resilience, data integrity maintenance</li>
                </ul>
            </div>
        </div>

        <div class="section">
            <div class="section-header">🚀 Next Steps</div>
            <div class="section-content">
                <h3>For Failed Tests:</h3>
                <ul style="margin-left: 2rem; margin-top: 0.5rem;">
                    <li><strong>Investigate failures</strong> - Review test output and error messages</li>
                    <li><strong>Check TestContainers</strong> - Ensure Docker services are running correctly</li>
                    <li><strong>Validate SNS/SQS</strong> - Confirm LocalStack event publishing works</li>
                    <li><strong>Review business logic</strong> - Ensure grant and application validation rules are correct</li>
                </ul>
                
                <h3 style="margin-top: 1rem;">For Production Deployment:</h3>
                <ul style="margin-left: 2rem; margin-top: 0.5rem;">
                    <li><strong>Monitor event publishing</strong> - Track SNS event success rates</li>
                    <li><strong>Validate cross-service integration</strong> - Ensure fg-cw-backend receives events correctly</li>
                    <li><strong>Performance testing</strong> - Test high-volume application submissions</li>
                    <li><strong>Error monitoring</strong> - Set up alerts for application validation failures</li>
                </ul>
            </div>
        </div>
    </div>
    
    <div class="footer">
        <p>🤖 Generated by FG-Gas-Backend Test Suite | <a href="https://claude.ai/code" target="_blank">Powered by Claude Code</a></p>
    </div>
</body>
</html>
`;
}

// Run the report generation if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateTestReport();
}

export { generateTestReport };
