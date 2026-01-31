import { BarretenbergBackend, UltraHonkBackend } from '@noir-lang/backend_barretenberg';
import fs from 'fs';

// Load a test circuit
const circuitPath = './target/zvault_claim.json';
if (!fs.existsSync(circuitPath)) {
  console.log('Circuit not found at', circuitPath);
  process.exit(1);
}
const circuit = JSON.parse(fs.readFileSync(circuitPath, 'utf8'));
console.log('Circuit bytecode length:', circuit.bytecode?.length || 'N/A');

// Create backends to compare
console.log('\n--- BarretenbergBackend ---');
const bbBackend = new BarretenbergBackend(circuit);
console.log('BBBackend created');

console.log('\n--- UltraHonkBackend ---');
const uhBackend = new UltraHonkBackend(circuit);
console.log('UHBackend created');

// Check TypeScript definitions
console.log('\nChecking for Groth16 methods...');
console.log('BarretenbergBackend prototype:', Object.getOwnPropertyNames(BarretenbergBackend.prototype));
console.log('UltraHonkBackend prototype:', Object.getOwnPropertyNames(UltraHonkBackend.prototype));

// Try to find any groth16 related stuff
const bbMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(bbBackend));
const grothMethods = bbMethods.filter(m => m.toLowerCase().includes('groth'));
console.log('Groth16-related methods in BB backend:', grothMethods.length ? grothMethods : 'None found');

// Cleanup
await bbBackend.destroy();
await uhBackend.destroy();
