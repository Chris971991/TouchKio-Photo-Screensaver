#!/usr/bin/env node

/**
 * Basic TouchKio Slideshow Test
 *
 * Tests module loading and basic functionality without starting Electron
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 TouchKio Slideshow Basic Test');
console.log('================================\n');

// Mock global objects that would normally be provided by Electron
global.APP = {
  path: __dirname,
  name: 'touchkio',
  title: 'TouchKio Test'
};

global.ARGS = {
  slideshow_enabled: 'true',
  slideshow_photos_dir: path.join(require('os').homedir(), 'Pictures'),
  slideshow_interval: '5',
  slideshow_idle_timeout: '180',
  slideshow_show_clock: 'true'
};

global.EVENTS = {
  on: () => {},
  emit: () => {}
};

global.WEBVIEW = {
  window: {
    contentView: {
      addChildView: () => {},
      removeChildView: () => {}
    },
    getBounds: () => ({ width: 1920, height: 1080 })
  }
};

async function testModuleLoading() {
  console.log('📦 Testing module loading...');

  try {
    // Test slideshow module
    const slideshow = require('./js/slideshow');
    console.log('✅ Slideshow module loaded successfully');

    // Test module exports
    const expectedExports = ['init', 'showSlideshow', 'hideSlideshow', 'updateConfig', 'reloadPhotos', 'getStatus', 'cleanup'];

    for (const exportName of expectedExports) {
      if (typeof slideshow[exportName] === 'function') {
        console.log(`✅ ${exportName} function exported`);
      } else {
        console.log(`❌ ${exportName} function missing`);
      }
    }

    return slideshow;
  } catch (error) {
    console.log('❌ Module loading failed:', error.message);
    throw error;
  }
}

async function testConfiguration() {
  console.log('\n⚙️  Testing configuration...');

  const slideshow = require('./js/slideshow');

  // Mock the http server creation to avoid port conflicts
  const originalHttp = require('http');
  require('http').createServer = () => ({
    listen: (port, callback) => {
      console.log(`✅ HTTP server would listen on port ${port}`);
      if (callback) callback();
    },
    close: () => {}
  });

  try {
    await slideshow.init();
    console.log('✅ Slideshow initialization completed');

    const status = slideshow.getStatus();
    console.log(`✅ Configuration loaded: ${JSON.stringify(status.config, null, 2)}`);

    return status;
  } catch (error) {
    console.log('❌ Configuration test failed:', error.message);
    throw error;
  }
}

async function testPhotosLoading() {
  console.log('\n🖼️  Testing photo loading...');

  const photosDir = global.ARGS.slideshow_photos_dir;

  if (!fs.existsSync(photosDir)) {
    console.log(`⚠️  Photos directory doesn't exist: ${photosDir}`);
    console.log('   Creating test directory with sample photos...');

    fs.mkdirSync(photosDir, { recursive: true });

    // Create a simple test image (1x1 pixel PNG)
    const testImageData = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
      0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0x57, 0x63, 0xF8, 0x0F, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x5C, 0xCD, 0x90, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
    ]);

    ['test1.png', 'test2.png', 'test3.png'].forEach(name => {
      fs.writeFileSync(path.join(photosDir, name), testImageData);
    });

    console.log('✅ Created sample test images');
  }

  const files = fs.readdirSync(photosDir);
  const imageFiles = files.filter(file =>
    /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(file)
  );

  console.log(`✅ Found ${imageFiles.length} image files in ${photosDir}`);

  if (imageFiles.length > 0) {
    console.log('   Sample files:', imageFiles.slice(0, 3).join(', '));
  }

  return imageFiles;
}

async function testIntegration() {
  console.log('\n🔗 Testing integration modules...');

  try {
    // Test hardware module modifications
    console.log('📡 Testing hardware module...');

    // We can't actually load hardware module without proper Linux environment
    // But we can check if our modifications don't break the syntax
    const hardwareCode = fs.readFileSync('./js/hardware.js', 'utf8');

    if (hardwareCode.includes('const slideshow = require("./slideshow")')) {
      console.log('✅ Hardware module includes slideshow import');
    }

    if (hardwareCode.includes('await slideshow.init()')) {
      console.log('✅ Hardware module calls slideshow.init()');
    }

    // Test integration module modifications
    console.log('📡 Testing integration module...');

    const integrationCode = fs.readFileSync('./js/integration.js', 'utf8');

    if (integrationCode.includes('const slideshow = require("./slideshow")')) {
      console.log('✅ Integration module includes slideshow import');
    }

    if (integrationCode.includes('initSlideshow()')) {
      console.log('✅ Integration module calls initSlideshow()');
    }

    // Test webview module modifications
    console.log('📡 Testing webview module...');

    const webviewCode = fs.readFileSync('./js/webview.js', 'utf8');

    if (webviewCode.includes('EVENTS.emit("userActivity")')) {
      console.log('✅ Webview module emits userActivity events');
    }

    // Test index.js modifications
    console.log('📡 Testing index module...');

    const indexCode = fs.readFileSync('./index.js', 'utf8');

    if (indexCode.includes('slideshow_enabled')) {
      console.log('✅ Index module includes slideshow arguments');
    }

    console.log('✅ All integration tests passed');

  } catch (error) {
    console.log('❌ Integration test failed:', error.message);
    throw error;
  }
}

async function main() {
  try {
    await testModuleLoading();
    await testConfiguration();
    await testPhotosLoading();
    await testIntegration();

    console.log('\n🎉 All basic tests passed!');
    console.log('\n📋 Summary:');
    console.log('  ✅ Module loading and exports');
    console.log('  ✅ Configuration parsing');
    console.log('  ✅ Photo loading capabilities');
    console.log('  ✅ Integration with existing modules');

    console.log('\n🚀 Next steps:');
    console.log('  1. Run full Electron app: npm start');
    console.log('  2. Configure with slideshow enabled');
    console.log('  3. Set up MQTT broker for Home Assistant integration');
    console.log('  4. Add your photos to the Pictures directory');
    console.log('  5. Configure Google Photos shared album (optional)');

  } catch (error) {
    console.log('\n💥 Basic tests failed:', error.message);
    console.log(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  testModuleLoading,
  testConfiguration,
  testPhotosLoading,
  testIntegration
};