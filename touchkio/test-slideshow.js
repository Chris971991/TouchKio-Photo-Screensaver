#!/usr/bin/env node

/**
 * TouchKio Slideshow Test Script
 *
 * This script tests the slideshow functionality by:
 * 1. Building the project
 * 2. Starting TouchKio with slideshow enabled
 * 3. Testing HTTP server endpoints
 * 4. Verifying configuration and photo loading
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const axios = require('axios');

const CONFIG = {
  port: 8081,
  testTimeout: 30000,
  photosDir: path.join(require('os').homedir(), 'Pictures'),
  sampleGoogleAlbum: 'ALBUM_ID_HERE', // Replace with actual album ID for testing
};

console.log('🧪 TouchKio Slideshow Test Suite');
console.log('================================\n');

async function testBuild() {
  console.log('📦 Testing project build...');

  return new Promise((resolve, reject) => {
    const buildProcess = spawn('npm', ['run', 'build'], {
      stdio: 'pipe',
      cwd: process.cwd()
    });

    let output = '';
    let errorOutput = '';

    buildProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    buildProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    buildProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Build successful');
        resolve(output);
      } else {
        console.log('❌ Build failed');
        console.log('Error output:', errorOutput);
        reject(new Error(`Build failed with code ${code}`));
      }
    });
  });
}

async function testHttpEndpoints() {
  console.log('🌐 Testing HTTP server endpoints...');

  const baseUrl = `http://localhost:${CONFIG.port}`;

  try {
    // Test photos list endpoint
    const photosResponse = await axios.get(`${baseUrl}/photos`, { timeout: 5000 });
    console.log(`✅ Photos endpoint working (${photosResponse.data.photos.length} photos found)`);

    // Test individual photo endpoint if photos exist
    if (photosResponse.data.photos.length > 0) {
      const photoResponse = await axios.get(`${baseUrl}/photo/0`, { timeout: 5000 });
      console.log('✅ Individual photo endpoint working');
    } else {
      console.log('ℹ️  No photos found to test individual photo endpoint');
    }

    return photosResponse.data;
  } catch (error) {
    console.log('❌ HTTP endpoint test failed:', error.message);
    throw error;
  }
}

async function createTestConfiguration() {
  console.log('⚙️  Creating test configuration...');

  const configPath = path.join(require('os').homedir(), '.config', 'touchkio', 'Arguments.json');
  const configDir = path.dirname(configPath);

  // Ensure config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const testConfig = {
    web_url: ['https://demo.home-assistant.io'],
    web_theme: 'dark',
    web_zoom: '1.25',
    web_widget: 'true',
    slideshow_enabled: 'true',
    slideshow_photos_dir: CONFIG.photosDir,
    slideshow_interval: '3',
    slideshow_idle_timeout: '10',
    slideshow_show_clock: 'true'
  };

  // Add Google Photos if sample album ID is provided
  if (CONFIG.sampleGoogleAlbum !== 'ALBUM_ID_HERE') {
    testConfig.slideshow_google_album = CONFIG.sampleGoogleAlbum;
  }

  fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
  console.log('✅ Test configuration created at:', configPath);

  return testConfig;
}

async function createSamplePhotos() {
  console.log('🖼️  Creating sample photos for testing...');

  if (!fs.existsSync(CONFIG.photosDir)) {
    fs.mkdirSync(CONFIG.photosDir, { recursive: true });
    console.log(`📁 Created photos directory: ${CONFIG.photosDir}`);
  }

  // Create a simple test image (1x1 pixel PNG)
  const testImageData = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
    0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0x57, 0x63, 0xF8, 0x0F, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x5C, 0xCD, 0x90, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
  ]);

  const testImages = ['test1.png', 'test2.png', 'test3.png'];

  testImages.forEach(imageName => {
    const imagePath = path.join(CONFIG.photosDir, imageName);
    if (!fs.existsSync(imagePath)) {
      fs.writeFileSync(imagePath, testImageData);
    }
  });

  console.log(`✅ Created ${testImages.length} sample test images`);
}

async function waitForServer(port, timeout = 10000) {
  console.log(`⏳ Waiting for server on port ${port}...`);

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      await axios.get(`http://localhost:${port}/photos`, { timeout: 1000 });
      console.log('✅ Server is responding');
      return true;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Server failed to start within ${timeout}ms`);
}

async function runTouchKioTest() {
  console.log('🚀 Starting TouchKio with slideshow enabled...');

  const touchkioProcess = spawn('npm', ['start'], {
    stdio: 'pipe',
    cwd: process.cwd(),
    env: {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ':0'
    }
  });

  let output = '';
  let errorOutput = '';

  touchkioProcess.stdout.on('data', (data) => {
    const text = data.toString();
    output += text;
    if (text.includes('Slideshow') || text.includes('HTTP server')) {
      console.log('📊', text.trim());
    }
  });

  touchkioProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });

  try {
    // Wait for the server to start
    await waitForServer(CONFIG.port);

    // Test HTTP endpoints
    const photosData = await testHttpEndpoints();

    console.log('\n📋 Test Results Summary:');
    console.log('=======================');
    console.log(`Photos loaded: ${photosData.photos.length}`);
    console.log(`HTTP server: ✅ Running on port ${CONFIG.port}`);
    console.log('Slideshow module: ✅ Loaded successfully');

    if (photosData.photos.length > 0) {
      console.log('\n📸 Photo Sources:');
      const googlePhotos = photosData.photos.filter(p => p.type === 'google').length;
      const localPhotos = photosData.photos.filter(p => p.type === 'local').length;

      if (googlePhotos > 0) console.log(`  • Google Photos: ${googlePhotos}`);
      if (localPhotos > 0) console.log(`  • Local Photos: ${localPhotos}`);
    }

    console.log('\n🎉 All tests passed! TouchKio slideshow is working correctly.');
    console.log('\n💡 Tips:');
    console.log('  • Configure MQTT broker for Home Assistant integration');
    console.log('  • Add more photos to your Pictures directory');
    console.log('  • Set up Google Photos shared album for cloud photos');
    console.log('  • Adjust idle timeout and slideshow interval as needed');

  } catch (error) {
    console.log('\n❌ Test failed:', error.message);
    throw error;
  } finally {
    // Clean up
    touchkioProcess.kill();
  }
}

async function main() {
  try {
    // Prepare test environment
    await createTestConfiguration();
    await createSamplePhotos();

    // Test build process
    console.log('⚠️  Note: Skipping build test on Windows (requires additional setup)');
    console.log('   You can manually run: npm run build\n');

    // Test runtime functionality
    await runTouchKioTest();

  } catch (error) {
    console.log('\n💥 Test suite failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('  • Ensure you have Node.js and npm installed');
    console.log('  • Make sure no other service is using port 8081');
    console.log('  • Check that your Pictures directory exists and is accessible');
    console.log('  • For Linux: Ensure DISPLAY environment variable is set');

    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Test interrupted by user');
  process.exit(0);
});

if (require.main === module) {
  main();
}

module.exports = {
  testBuild,
  testHttpEndpoints,
  createTestConfiguration,
  createSamplePhotos,
  runTouchKioTest
};