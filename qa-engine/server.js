import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
const TESTS_DIR = join(__dirname, 'tests');

// Ensure tests directory exists
if (!fs.existsSync(TESTS_DIR)) {
    fs.mkdirSync(TESTS_DIR, { recursive: true });
}

// Endpoint to get all test files
app.get('/api/tests', (req, res) => {
    try {
        const files = fs.readdirSync(TESTS_DIR).filter(f => f.endsWith('.spec.js') || f.endsWith('.spec.ts'));
        res.json({ tests: files });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint to create a new test file
app.post('/api/tests', (req, res) => {
    const { name, content } = req.body;
    if (!name || !content) return res.status(400).json({ error: 'Name and content required' });
    
    const safeName = name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    const filePath = join(TESTS_DIR, `${safeName}.spec.js`);
    
    try {
        fs.writeFileSync(filePath, content);
        res.json({ message: 'Test created successfully', file: `${safeName}.spec.js` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint to run tests
app.post('/api/run', (req, res) => {
    // Webhook implementation (Phase 3)
    const { testFile, targetUrl, webhookUrl } = req.body;
    
    let cmd = 'npx playwright test';
    if (testFile) {
        cmd += ` tests/${testFile}`;
    }

    const env = { ...process.env, PLAYWRIGHT_HTML_REPORT: 'playwright-report' };
    if (targetUrl) {
        env.BASE_URL = targetUrl;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const processRef = exec(cmd, { env });

    processRef.stdout.on('data', (data) => {
        res.write(`data: ${JSON.stringify({ type: 'stdout', data: data.toString() })}\n\n`);
    });

    processRef.stderr.on('data', (data) => {
        res.write(`data: ${JSON.stringify({ type: 'stderr', data: data.toString() })}\n\n`);
    });

    processRef.on('close', async (code) => {
        // Fire webhook on failure
        if (code !== 0 && webhookUrl) {
            try {
                await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: `🚨 *QA Engine Alert* 🚨\nAutomated test run failed!\nExit Code: ${code}\nTarget: ${targetUrl || 'Default'}` })
                });
            } catch (e) {
                console.error("Webhook failed:", e);
            }
        }
        res.write(`data: ${JSON.stringify({ type: 'exit', code })}\n\n`);
        res.end();
    });
});

// Phase 4: Basic memory scheduling
let scheduledJobs = [];
app.post('/api/schedule', (req, res) => {
    const { time, suite } = req.body; // time like "02:00"
    scheduledJobs.push({ time, suite, active: true });
    res.json({ message: 'Scheduled successfully', jobs: scheduledJobs });
});

// Phase 1: Static serving for Playwright Report & Traces
app.use('/report', express.static(join(__dirname, '../playwright-report')));

app.listen(PORT, () => {
    console.log(`QA Platform Backend running on http://localhost:${PORT}`);
});
