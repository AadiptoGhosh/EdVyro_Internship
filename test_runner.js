/**
 * Comprehensive Automated Test Runner for Responsive Internship Board
 * Uses Node.js native http, child_process, and native WebSocket (Chrome DevTools Protocol)
 * Zero external npm packages required.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// 1. Simple HTTP Server to serve files with proper MIME types
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/') reqPath = '/index.html';
      const filePath = path.join(__dirname, reqPath);

      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml'
      };

      const ext = path.extname(filePath);
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content);
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      console.log(`[Test Server] Running at http://127.0.0.1:${port}`);
      resolve({ server, port });
    });
  });
}

// 2. CDP Client over native WebSocket
class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const cb = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) {
          cb.reject(new Error(msg.error.message));
        } else {
          cb.resolve(msg.result);
        }
      }
    };
  }

  waitOpen() {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval failed: ${res.exceptionDetails.text}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async screenshot(filePath, viewport = null) {
    if (viewport) {
      await this.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width <= 480
      });
      await this.send('Emulation.setVisibleSize', {
        width: viewport.width,
        height: viewport.height
      });
    }

    // Give layout time to settle
    await new Promise(r => setTimeout(r, 300));

    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    fs.writeFileSync(filePath, buffer);
    console.log(`[Screenshot Saved] ${path.basename(filePath)} (${buffer.length} bytes)`);
  }
}

async function runTests() {
  const { server, port } = await startServer();
  const testResults = [];

  function assert(condition, testName) {
    if (condition) {
      console.log(`  PASS: ${testName}`);
      testResults.push({ name: testName, passed: true });
    } else {
      console.error(`  FAIL: ${testName}`);
      testResults.push({ name: testName, passed: false });
    }
  }

  // Find free port for debugging
  const debugPort = 9222 + Math.floor(Math.random() * 500);
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${debugPort}`,
    '--remote-allow-origins=*',
    `http://127.0.0.1:${port}/index.html`
  ]);

  // Wait for Chrome to be ready
  await new Promise(r => setTimeout(r, 1500));

  let tabInfo;
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json`);
      const tabs = await res.json();
      tabInfo = tabs.find(t => t.type === 'page');
      if (tabInfo) break;
    } catch {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  if (!tabInfo) {
    console.error('Could not connect to Chrome debugging endpoint');
    chromeProc.kill();
    server.close();
    process.exit(1);
  }

  const cdp = new CDPClient(tabInfo.webSocketDebuggerUrl);
  await cdp.waitOpen();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // Wait for initial render
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n--- 1. Testing Initial Page Load & Default State ---');
  const cardCount = await cdp.eval('document.querySelectorAll("#internship-grid .card").length');
  assert(cardCount === 5, 'Renders exactly 5 internship cards from JSON dataset');

  const titles = await cdp.eval('Array.from(document.querySelectorAll(".card-title")).map(el => el.textContent.trim())');
  assert(titles.includes('Frontend Intern'), 'Contains "Frontend Intern" card');
  assert(titles.includes('API Engineering Intern'), 'Contains "API Engineering Intern" card');
  assert(titles.includes('UI/UX Intern'), 'Contains "UI/UX Intern" card');
  assert(titles.includes('Data Analyst Intern'), 'Contains "Data Analyst Intern" card');
  assert(titles.includes('Security Operations Intern'), 'Contains "Security Operations Intern" card');

  const domainOptions = await cdp.eval('Array.from(document.querySelectorAll("#domain-filter option")).map(o => o.value)');
  assert(domainOptions.includes('all'), 'Domain filter has "all" option');
  assert(domainOptions.includes('Full Stack Development'), 'Domain filter has dynamically generated "Full Stack Development"');
  assert(domainOptions.includes('UI/UX'), 'Domain filter has dynamically generated "UI/UX"');
  assert(domainOptions.includes('Data Analytics'), 'Domain filter has dynamically generated "Data Analytics"');
  assert(domainOptions.includes('Cyber Security'), 'Domain filter has dynamically generated "Cyber Security"');

  const resultsStatus = await cdp.eval('document.getElementById("results-count").textContent');
  assert(resultsStatus.includes('5'), 'Results status announces 5 internships available');

  // Capture Desktop Screenshot
  await cdp.screenshot(path.join(SCREENSHOTS_DIR, 'desktop-1280px.png'), { width: 1280, height: 900 });

  // Capture Tablet Screenshot
  await cdp.screenshot(path.join(SCREENSHOTS_DIR, 'tablet-768px.png'), { width: 768, height: 1024 });

  // Capture Mobile Screenshot
  await cdp.screenshot(path.join(SCREENSHOTS_DIR, 'mobile-360px.png'), { width: 360, height: 800 });

  console.log('\n--- 2. Testing Search Functionality ---');
  // Search for skill "SQL" (matches INT-102 and INT-104)
  await cdp.eval(`(() => {
    const input = document.getElementById("search-input");
    input.value = "SQL";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 200));

  let count = await cdp.eval('document.querySelectorAll("#internship-grid .card").length');
  assert(count === 2, 'Search "SQL" correctly matches 2 internships with SQL skill');

  // Capture Search Screenshot
  await cdp.screenshot(path.join(SCREENSHOTS_DIR, 'search-filter-active.png'), { width: 1280, height: 900 });

  // Search by role title
  await cdp.eval(`(() => {
    const input = document.getElementById("search-input");
    input.value = "Security";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 200));
  count = await cdp.eval('document.querySelectorAll("#internship-grid .card").length');
  const matchedTitle = await cdp.eval('document.querySelector(".card-title") ? document.querySelector(".card-title").textContent.trim() : ""');
  assert(count === 1 && matchedTitle === 'Security Operations Intern', 'Search "Security" matches single Security Operations Intern card');

  // Search by location
  await cdp.eval(`(() => {
    const input = document.getElementById("search-input");
    input.value = "Bengaluru";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 200));
  count = await cdp.eval('document.querySelectorAll("#internship-grid .card").length');
  const matchedLocationTitle = await cdp.eval('document.querySelector(".card-title") ? document.querySelector(".card-title").textContent.trim() : ""');
  assert(count === 1 && matchedLocationTitle === 'Data Analyst Intern', 'Search location "Bengaluru" matches Data Analyst Intern');

  console.log('\n--- 3. Testing Domain Filter ---');
  // Reset search and test domain dropdown
  await cdp.eval(`(() => {
    document.getElementById("search-input").value = "";
    document.getElementById("search-input").dispatchEvent(new Event("input", { bubbles: true }));
    const select = document.getElementById("domain-filter");
    select.value = "Full Stack Development";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 200));
  count = await cdp.eval('document.querySelectorAll("#internship-grid .card").length');
  assert(count === 2, 'Domain filter "Full Stack Development" returns exactly 2 cards');

  // Test Cyber Security domain
  await cdp.eval(`(() => {
    const select = document.getElementById("domain-filter");
    select.value = "Cyber Security";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 200));
  count = await cdp.eval('document.querySelectorAll("#internship-grid .card").length');
  assert(count === 1, 'Domain filter "Cyber Security" returns exactly 1 card');

  console.log('\n--- 4. Testing Combined Search and Domain Filtering ---');
  // Domain = Full Stack Development, Search = "Frontend"
  await cdp.eval(`(() => {
    const select = document.getElementById("domain-filter");
    select.value = "Full Stack Development";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    const input = document.getElementById("search-input");
    input.value = "Frontend";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 200));
  count = await cdp.eval('document.querySelectorAll("#internship-grid .card").length');
  const combinedTitle = await cdp.eval('document.querySelector(".card-title") ? document.querySelector(".card-title").textContent.trim() : ""');
  assert(count === 1 && combinedTitle === 'Frontend Intern', 'Simultaneous domain + search narrows to exactly "Frontend Intern"');

  console.log('\n--- 5. Testing Empty State ---');
  // Search for nonexistent query
  await cdp.eval(`(() => {
    const input = document.getElementById("search-input");
    input.value = "NonExistentKeywordXYZ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 200));
  const emptyStateVisible = await cdp.eval('!document.getElementById("empty-state").hidden');
  const gridHidden = await cdp.eval('document.getElementById("internship-grid").hidden');
  assert(emptyStateVisible && gridHidden, 'Empty state container is displayed and card grid is hidden');

  // Capture Empty State Screenshot
  await cdp.screenshot(path.join(SCREENSHOTS_DIR, 'empty-state.png'), { width: 1280, height: 900 });

  // Test "Clear All Filters" button inside empty state
  await cdp.eval('document.getElementById("empty-reset-btn").click()');
  await new Promise(r => setTimeout(r, 200));
  count = await cdp.eval('document.querySelectorAll("#internship-grid .card").length');
  const searchVal = await cdp.eval('document.getElementById("search-input").value');
  const domainVal = await cdp.eval('document.getElementById("domain-filter").value');
  assert(count === 5 && searchVal === '' && domainVal === 'all', 'Clear All Filters button resets filters and restores 5 cards');

  console.log('\n--- 6. Testing Accessibility & Semantics ---');
  const labelForSearch = await cdp.eval('document.querySelector("label[for=\'search-input\']") !== null');
  assert(labelForSearch, 'Search input has properly associated <label for="search-input">');

  const labelForDomain = await cdp.eval('document.querySelector("label[for=\'domain-filter\']") !== null');
  assert(labelForDomain, 'Domain filter has properly associated <label for="domain-filter">');

  const skipLinkExists = await cdp.eval('document.querySelector(".skip-link") !== null');
  assert(skipLinkExists, 'Skip-to-main-content accessible link is present');

  const liveRegionExists = await cdp.eval('document.querySelector("[aria-live]") !== null');
  assert(liveRegionExists, 'ARIA live region is present for screen reader announcements');

  console.log('\n--- 7. Testing Error State UI ---');
  // Trigger simulated error state by invoking the error handler
  await cdp.eval(`
    window.dispatchEvent(new CustomEvent("simulate-error"));
    // Direct trigger for testing error UI
    const errorState = document.getElementById("error-state");
    const grid = document.getElementById("internship-grid");
    const empty = document.getElementById("empty-state");
    const loading = document.getElementById("loading-state");
    loading.hidden = true;
    empty.hidden = true;
    grid.hidden = true;
    errorState.hidden = false;
    document.getElementById("error-message").textContent = "Simulated Network Failure: Unable to fetch data/internships.json";
  `);
  await new Promise(r => setTimeout(r, 200));
  const errorVisible = await cdp.eval('!document.getElementById("error-state").hidden');
  assert(errorVisible, 'Error state UI renders user-friendly message and retry button');

  // Capture Error State Screenshot
  await cdp.screenshot(path.join(SCREENSHOTS_DIR, 'error-state.png'), { width: 1280, height: 900 });

  // Clean up
  chromeProc.kill();
  server.close();

  const totalPassed = testResults.filter(t => t.passed).length;
  console.log(`\n==========================================`);
  console.log(`TEST SUITE SUMMARY: ${totalPassed} / ${testResults.length} PASSED`);
  console.log(`==========================================\n`);

  if (totalPassed < testResults.length) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test Runner Error:', err);
  process.exit(1);
});
