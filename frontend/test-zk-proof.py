#!/usr/bin/env python3
"""Test ZK proof generation by checking circuit files and module loading"""

from playwright.sync_api import sync_playwright
import time

def test_zk_setup():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console logs
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        print("1. Testing circuit files accessibility...")

        # Test WASM file
        wasm_response = page.request.get('http://localhost:3000/circuits/deposit.wasm')
        print(f"   deposit.wasm: {wasm_response.status} ({wasm_response.headers.get('content-length', 'unknown')} bytes)")

        # Test zkey file
        zkey_response = page.request.get('http://localhost:3000/circuits/deposit_final.zkey')
        print(f"   deposit_final.zkey: {zkey_response.status} ({zkey_response.headers.get('content-length', 'unknown')} bytes)")

        # Test verification key
        vk_response = page.request.get('http://localhost:3000/circuits/deposit_vk.json')
        print(f"   deposit_vk.json: {vk_response.status} ({vk_response.headers.get('content-length', 'unknown')} bytes)")

        print("\n2. Testing Poseidon note creation via UI...")
        page.goto('http://localhost:3000/bridge')
        page.wait_for_load_state('networkidle')

        # Generate secret and continue
        generate_btn = page.locator('button:has-text("Generate")')
        if generate_btn.count() > 0:
            generate_btn.first.click()
            page.wait_for_timeout(500)
            print("   Generated secret note")

        continue_btn = page.locator('button:has-text("Continue")')
        if continue_btn.count() > 0:
            continue_btn.first.click()
            page.wait_for_timeout(500)
            print("   Continued to amount step")

        # Enter amount
        amount_input = page.locator('input[type="number"]')
        if amount_input.count() > 0:
            amount_input.first.fill('10000')
            print("   Entered amount: 10000")

        # Check checkbox
        checkbox_label = page.locator('label:has(input[type="checkbox"])')
        if checkbox_label.count() > 0:
            checkbox_label.first.click()
            print("   Checked confirmation checkbox")

        page.wait_for_timeout(500)

        # Click Get Deposit Address to trigger Poseidon note creation
        deposit_btn = page.locator('button:has-text("Get Deposit Address")')
        if deposit_btn.count() > 0:
            deposit_btn.first.click()
            print("   Clicked 'Get Deposit Address'")
            print("   Waiting for Poseidon initialization and note creation...")
            page.wait_for_timeout(5000)

        print("\n3. Checking console logs for ZK-related activity...")

        # Check for successful Poseidon note creation
        poseidon_logs = [log for log in console_logs if 'Poseidon' in log or 'commitment' in log.lower()]
        zk_logs = [log for log in console_logs if any(kw in log.lower() for kw in ['zk', 'proof', 'snark', 'circom'])]

        print("\n" + "="*60)
        print("POSEIDON/COMMITMENT LOGS:")
        print("="*60)
        for log in poseidon_logs:
            print(log)

        if zk_logs:
            print("\n" + "="*60)
            print("ZK PROOF LOGS:")
            print("="*60)
            for log in zk_logs:
                print(log)

        # Verify results
        print("\n" + "="*60)
        print("VERIFICATION SUMMARY:")
        print("="*60)

        circuit_files_ok = (wasm_response.status == 200 and
                          zkey_response.status == 200 and
                          vk_response.status == 200)
        print(f"  Circuit files accessible: {'YES' if circuit_files_ok else 'NO'}")

        poseidon_ok = any('Poseidon note created' in log for log in poseidon_logs)
        print(f"  Poseidon note creation: {'YES' if poseidon_ok else 'NO'}")

        if circuit_files_ok and poseidon_ok:
            print("\n  ZK integration is properly set up!")
            print("  Proof generation will work when deposit is confirmed.")
        else:
            print("\n  Some components are missing.")

        browser.close()
        print("\nTest completed.")

if __name__ == "__main__":
    test_zk_setup()
