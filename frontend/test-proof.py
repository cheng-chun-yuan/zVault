#!/usr/bin/env python3
"""Test ZK proof generation in the deposit flow"""

from playwright.sync_api import sync_playwright
import time

def test_deposit_flow():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console logs
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        print("1. Navigating to /bridge...")
        page.goto('http://localhost:3000/bridge')
        page.wait_for_load_state('networkidle')

        # Take initial screenshot
        page.screenshot(path='/tmp/bridge-1-initial.png', full_page=True)
        print("   Screenshot saved: /tmp/bridge-1-initial.png")

        # Step 1: Enter secret note
        print("\n2. Entering secret note...")
        # Look for the secret input or generate button
        try:
            # Click generate secret button
            generate_btn = page.locator('button:has-text("Generate")')
            if generate_btn.count() > 0:
                generate_btn.first.click()
                page.wait_for_timeout(500)
                print("   Clicked 'Generate' button")

            page.screenshot(path='/tmp/bridge-2-secret.png', full_page=True)
            print("   Screenshot saved: /tmp/bridge-2-secret.png")

            # Click continue
            continue_btn = page.locator('button:has-text("Continue")')
            if continue_btn.count() > 0:
                continue_btn.first.click()
                page.wait_for_timeout(500)
                print("   Clicked 'Continue' button")
        except Exception as e:
            print(f"   Error in secret step: {e}")

        # Step 2: Enter amount
        print("\n3. Entering amount...")
        page.screenshot(path='/tmp/bridge-3-amount-page.png', full_page=True)
        try:
            # Find amount input
            amount_input = page.locator('input[type="number"]')
            if amount_input.count() > 0:
                amount_input.first.fill('10000')
                print("   Entered amount: 10000")

            page.wait_for_timeout(500)
            page.screenshot(path='/tmp/bridge-4-amount-entered.png', full_page=True)

            # Check the confirmation checkbox - click on label instead of input to avoid overlay
            checkbox_label = page.locator('label:has(input[type="checkbox"])')
            if checkbox_label.count() > 0:
                checkbox_label.first.click()
                print("   Clicked confirmation checkbox label")
            else:
                # Try clicking the checkbox container div
                checkbox_container = page.locator('div:has(> input[type="checkbox"])')
                if checkbox_container.count() > 0:
                    checkbox_container.first.click(force=True)
                    print("   Clicked checkbox container")

            page.wait_for_timeout(300)

            # Click Get Deposit Address
            deposit_btn = page.locator('button:has-text("Get Deposit Address")')
            if deposit_btn.count() > 0:
                deposit_btn.first.click()
                print("   Clicked 'Get Deposit Address' button")
                print("   Waiting for Poseidon init and address generation...")
                page.wait_for_timeout(5000)  # Wait for Poseidon init and address generation
        except Exception as e:
            print(f"   Error in amount step: {e}")

        page.screenshot(path='/tmp/bridge-6-after-deposit.png', full_page=True)
        print("   Screenshot saved: /tmp/bridge-6-after-deposit.png")

        # Step 4: Click "I've Sent the BTC" button
        print("\n4. Clicking 'I've Sent the BTC' button...")
        try:
            sent_btn = page.locator('button:has-text("Sent the BTC")')
            if sent_btn.count() > 0:
                sent_btn.first.click()
                print("   Clicked 'I've Sent the BTC' button")
                page.wait_for_timeout(3000)  # Wait for state transition
        except Exception as e:
            print(f"   Error clicking sent button: {e}")

        page.screenshot(path='/tmp/bridge-7-waiting-confirm.png', full_page=True)
        print("   Screenshot saved: /tmp/bridge-7-waiting-confirm.png")

        # Step 5: Simulate deposit confirmation (click "Mock Deposit Confirmed" if available)
        print("\n5. Looking for confirmation options...")
        try:
            # Look for any dev/mock confirmation button
            mock_btn = page.locator('button:has-text("Mock")')
            if mock_btn.count() > 0:
                mock_btn.first.click()
                print("   Clicked mock confirmation button")
                page.wait_for_timeout(3000)

            # Look for "Mint sbBTC" button which triggers ZK proof
            mint_btn = page.locator('button:has-text("Mint")')
            if mint_btn.count() > 0:
                print("   Found 'Mint' button - clicking...")
                mint_btn.first.click()
                print("   Clicked 'Mint' button - waiting for ZK proof generation...")
                page.wait_for_timeout(10000)  # Wait for ZK proof generation
        except Exception as e:
            print(f"   Error in confirmation step: {e}")

        page.screenshot(path='/tmp/bridge-8-final.png', full_page=True)
        print("   Screenshot saved: /tmp/bridge-8-final.png")

        # Wait a bit more for any async operations
        page.wait_for_timeout(2000)

        page.screenshot(path='/tmp/bridge-5-waiting.png', full_page=True)
        print("   Screenshot saved: /tmp/bridge-5-waiting.png")

        # Print console logs
        print("\n" + "="*50)
        print("CONSOLE LOGS (ZK/Proof related):")
        print("="*50)
        zk_keywords = ['Deposit', 'ZK', 'Poseidon', 'proof', 'commitment', 'nullifier',
                       'secret', 'note', 'circom', 'snark', 'groth16', 'wasm', 'zkey',
                       'Prepare', 'Mint', 'Amount', 'taproot', 'address']
        zk_logs = [log for log in console_logs
                   if any(kw.lower() in log.lower() for kw in zk_keywords)]

        for log in zk_logs:
            print(log)

        if not zk_logs:
            print("(No ZK-related logs captured)")

        print("\n" + "="*50)
        print("ALL CONSOLE LOGS (last 30):")
        print("="*50)
        for log in console_logs[-30:]:
            print(log)

        browser.close()
        print("\n✓ Test completed")

if __name__ == "__main__":
    test_deposit_flow()
