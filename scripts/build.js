import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Make the build/index.js file executable
try {
  fs.chmodSync(path.join(__dirname, '..', 'build', 'index.js'), '755');
} catch (e) {
  // Ignore if doesn't exist yet, it's just a permission change
}

// Copy the scripts directory to the build directory
try {
  // Ensure the build/scripts directory exists
  const buildScriptsDir = path.join(__dirname, '..', 'build', 'scripts');
  if (!fs.existsSync(buildScriptsDir)) {
    fs.mkdirSync(buildScriptsDir, { recursive: true });
  }
  
  // Copy the godot_operations.gd file
  fs.copyFileSync(
    path.join(__dirname, '..', 'src', 'scripts', 'godot_operations.gd'),
    path.join(buildScriptsDir, 'godot_operations.gd')
  );
  
  // Copy the mcp_interaction_server.gd file
  fs.copyFileSync(
    path.join(__dirname, '..', 'src', 'scripts', 'mcp_interaction_server.gd'),
    path.join(buildScriptsDir, 'mcp_interaction_server.gd')
  );

  // Copy the validate_script.gd file
  fs.copyFileSync(
    path.join(__dirname, '..', 'src', 'scripts', 'validate_script.gd'),
    path.join(buildScriptsDir, 'validate_script.gd')
  );

  console.log('Successfully copied scripts to build/scripts');
} catch (error) {
  console.error('Error copying scripts:', error);
  process.exit(1);
}

console.log('Build scripts completed successfully!');
