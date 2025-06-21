// Get all necessary DOM elements
const connectWalletBtn = document.getElementById('connectWalletBtn');
const installMetaMask = document.getElementById('installMetaMask');
const connectContainer = document.getElementById('connect-container');
const appContainer = document.getElementById('app-container');
const walletAddressEl = document.getElementById('walletAddress');
const networkStatusEl = document.getElementById('networkStatus');
const multisenderContractAddressInput = document.getElementById('multisenderContractAddress');
const tokenContractAddressInput = document.getElementById('tokenContractAddress');
const recipientsDataInput = document.getElementById('recipientsData');
const approveBtn = document.getElementById('approveBtn');
const sendBtn = document.getElementById('sendBtn');
const logEl = document.getElementById('log');
const fillExampleBtn = document.getElementById('fillExample');

// Constants for Monad Testnet and ABIs
const MONAD_TESTNET_CHAIN_ID = '0x279f'; // 10143
const MONAD_TESTNET_INFO = {
    chainId: MONAD_TESTNET_CHAIN_ID,
    chainName: 'Monad Testnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: ['https://testnet-rpc.monad.xyz/'],
    blockExplorerUrls: ['https://testnet.monadexplorer.com/'],
};
const MIN_MULTISENDER_ABI = ["function disperseToken(address tokenAddress, address[] calldata recipients, uint256[] calldata amounts)"];
const MIN_ERC20_ABI = ["function approve(address spender, uint256 amount) returns (bool)", "function decimals() view returns (uint8)", "function allowance(address owner, address spender) view returns (uint256)", "function symbol() view returns (string)"];

// Global variables for ethers.js
let provider, signer, userAddress;

/**
 * Logs a message to the on-screen log panel.
 * @param {string} message The message to log.
 * @param {boolean} isError Whether the message is an error.
 */
function log(message, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const p = document.createElement('p');
    p.innerHTML = `<span class="text-gray-500">${timestamp}:</span> ${message}`;
    p.classList.add(isError ? 'text-red-400' : 'text-green-300');
    
    // Clear the initial placeholder message if it exists
    if (logEl.children.length === 1 && logEl.children[0].textContent.startsWith("Log messages")) {
        logEl.innerHTML = '';
    }
    
    logEl.appendChild(p);
    logEl.scrollTop = logEl.scrollHeight; // Auto-scroll to the bottom
}

/**
 * Connects to the user's Ethereum wallet (MetaMask).
 */
async function connectWallet() {
    if (typeof window.ethereum === 'undefined') {
        installMetaMask.classList.remove('hidden');
        return;
    }
    try {
        log('Requesting wallet connection...');
        provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = provider.getSigner();
        userAddress = await signer.getAddress();
        
        // Update UI to show the main app
        connectContainer.classList.add('hidden');
        appContainer.classList.remove('hidden');
        walletAddressEl.textContent = userAddress;
        
        log('Successfully connected!');
        await checkAndSwitchNetwork();
    } catch (error) {
        console.error("Connection failed:", error);
        let userFriendlyError = '';
        if (error.code === 4001) {
            userFriendlyError = "You rejected the connection request in your wallet.";
        } else {
            // Provide a hint for a common issue with local files
            userFriendlyError = `${error.message}<br><strong class='text-yellow-300 mt-2 block'>Hint: Are you running this from a web server (http://)? Wallets like MetaMask may not work when opening a local file directly (file://).</strong>`;
        }
        log(`Connection Failed: ${userFriendlyError}`, true);
    }
}

/**
 * Checks if the user is on the correct network and prompts to switch if not.
 */
async function checkAndSwitchNetwork() {
    try {
        const network = await provider.getNetwork();
        if (network.chainId !== parseInt(MONAD_TESTNET_CHAIN_ID, 16)) {
            networkStatusEl.innerHTML = `<span class="text-yellow-400">Wrong Network. Please switch to Monad Testnet.</span> <button id="switchBtn" class="text-purple-400 hover:underline ml-2">Switch</button>`;
            document.getElementById('switchBtn').addEventListener('click', switchNetwork);
        } else {
            networkStatusEl.innerHTML = `<span class="text-green-400">Correctly connected to Monad Testnet.</span>`;
        }
    } catch (error) {
         log(`Failed to check network: ${error.message}`, true);
    }
}

/**
 * Requests the user to switch their network to Monad Testnet.
 */
async function switchNetwork() {
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: MONAD_TESTNET_CHAIN_ID }],
        });
    } catch (switchError) {
        // This error code indicates that the chain has not been added to MetaMask.
        if (switchError.code === 4902) {
            try {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [MONAD_TESTNET_INFO],
                });
            } catch (addError) {
                log('Failed to add Monad Testnet to MetaMask.', true);
            }
        } else {
            log('User rejected the network switch request.', true);
        }
    }
}

/**
 * Parses the recipient and amount data from the textarea.
 * @returns {{recipients: string[], amounts: string[]}} Parsed data.
 * @throws {Error} If data is invalid.
 */
function parseRecipientsData() {
    const data = recipientsDataInput.value.trim();
    if (!data) throw new Error("Recipients list is empty.");
    
    const lines = data.split('\n');
    const recipients = [], amounts = [];
    
    for(const line of lines) {
        if (line.trim() === '') continue;
        const parts = line.split(',').map(p => p.trim());
        if (parts.length !== 2) throw new Error(`Invalid format on line: "${line}"`);
        
        const [address, amountStr] = parts;
        if (!ethers.utils.isAddress(address)) throw new Error(`Invalid address: ${address}`);
        if (isNaN(parseFloat(amountStr)) || parseFloat(amountStr) <= 0) throw new Error(`Invalid amount: ${amountStr}`);
        
        recipients.push(address);
        amounts.push(amountStr);
    }
    return { recipients, amounts };
}

/**
 * Toggles the loading state of a button.
 * @param {HTMLElement} button The button element.
 * @param {boolean} isLoading Whether to show the loading state.
 */
function setButtonLoading(button, isLoading) {
    const text = button.querySelector('.btn-text');
    const spinner = button.querySelector('.loading-spinner');
    
    button.disabled = isLoading;
    text.style.display = isLoading ? 'none' : 'inline';
    spinner.style.display = isLoading ? 'block' : 'none';
}

/**
 * Handles the token approval process.
 */
async function handleApprove() {
    setButtonLoading(approveBtn, true);
    try {
        const multisenderAddress = multisenderContractAddressInput.value;
        const tokenAddress = tokenContractAddressInput.value;
        if (!ethers.utils.isAddress(multisenderAddress) || !ethers.utils.isAddress(tokenAddress)) throw new Error("Please enter valid contract addresses.");

        const { amounts } = parseRecipientsData();
        const tokenContract = new ethers.Contract(tokenAddress, MIN_ERC20_ABI, signer);
        const decimals = await tokenContract.decimals();
        const symbol = await tokenContract.symbol();
        
        let totalAmount = ethers.BigNumber.from(0);
        for (const amountStr of amounts) {
            totalAmount = totalAmount.add(ethers.utils.parseUnits(amountStr, decimals));
        }

        log(`Total: ${ethers.utils.formatUnits(totalAmount, decimals)} ${symbol}. Requesting approval...`);
        const tx = await tokenContract.approve(multisenderAddress, totalAmount);
        log(`Approval transaction sent. <a href="${MONAD_TESTNET_INFO.blockExplorerUrls[0]}/tx/${tx.hash}" target="_blank" class="text-purple-400 hover:underline">View Transaction</a>`);
        
        await tx.wait();
        log('Approval transaction confirmed successfully!');
    } catch (err) {
        log(`Approval Error: ${err.reason || err.message}`, true);
    } finally {
        setButtonLoading(approveBtn, false);
    }
}

/**
 * Handles the token dispersal process.
 */
async function handleDisperse() {
    setButtonLoading(sendBtn, true);
     try {
        const multisenderAddress = multisenderContractAddressInput.value;
        const tokenAddress = tokenContractAddressInput.value;
        if (!ethers.utils.isAddress(multisenderAddress) || !ethers.utils.isAddress(tokenAddress)) throw new Error("Please enter valid contract addresses.");

        const { recipients, amounts: amountsStr } = parseRecipientsData();
        const tokenContract = new ethers.Contract(tokenAddress, MIN_ERC20_ABI, signer);
        const decimals = await tokenContract.decimals();
        const amountsInWei = amountsStr.map(a => ethers.utils.parseUnits(a, decimals));
        const totalAmountInWei = amountsInWei.reduce((a, b) => a.add(b), ethers.BigNumber.from(0));

        log(`Checking allowance...`);
        const allowance = await tokenContract.allowance(userAddress, multisenderAddress);
        if (allowance.lt(totalAmountInWei)) throw new Error(`Allowance is not sufficient. Please run 'Approve' first.`);
        
        log('Allowance is sufficient. Dispersing tokens...');
        const multisenderContract = new ethers.Contract(multisenderAddress, MIN_MULTISENDER_ABI, signer);
        // Set a generous gas limit based on the number of recipients
        const tx = await multisenderContract.disperseToken(tokenAddress, recipients, amountsInWei, { gasLimit: ethers.BigNumber.from(recipients.length * 60000) });
        log(`Disperse transaction sent. <a href="${MONAD_TESTNET_INFO.blockExplorerUrls[0]}/tx/${tx.hash}" target="_blank" class="text-purple-400 hover:underline">View Transaction</a>`);
        
        await tx.wait();
        log('🎉 Disperse successful! Tokens have been sent.', false);
    } catch (err) {
        log(`Disperse Error: ${err.reason || err.message}`, true);
    } finally {
        setButtonLoading(sendBtn, false);
    }
}

// --- Event Listeners ---

connectWalletBtn.addEventListener('click', connectWallet);
approveBtn.addEventListener('click', handleApprove);
sendBtn.addEventListener('click', handleDisperse);
fillExampleBtn.addEventListener('click', () => {
    recipientsDataInput.value = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B,10\n0xdC25EF3F5B8a186998338A2ADA83795F52eAF183,2.5';
    log('Filled with example data.');
});

// Attempt to connect automatically if already connected on page load
window.addEventListener('load', () => {
    if (window.ethereum && window.ethereum.selectedAddress) {
        connectWallet();
    }
});

// Reload page on account or network changes for a simpler UX
if (window.ethereum) {
    window.ethereum.on('accountsChanged', () => location.reload());
    window.ethereum.on('chainChanged', () => location.reload());
}
