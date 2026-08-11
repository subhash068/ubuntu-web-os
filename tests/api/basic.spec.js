const { test, expect } = require('@playwright/test');

test.describe('Backend API Tests', () => {
  // A placeholder test that expects server.py to be running on localhost:5000
  // and serving the root index.html
  test('should return 200 for the main page', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
  });
});
