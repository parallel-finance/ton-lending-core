import { address, beginCell, Cell, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    // USDT
    const tokenAddress = address('EQColXOG7C2X8x0ZFT-3Ot5sYknz-JbLnJzI1eVNldQlX2Bu');
    const sampleJetton = provider.open(SampleJetton.fromAddress(tokenAddress));
    const providerJettonWalletAddress = await sampleJetton.getGetWalletAddress(provider.sender().address!!);
    const providerJettonWallet = provider.open(JettonDefaultWallet.fromAddress(providerJettonWalletAddress));
    await sleep(1000);
    const walletDataBefore = await providerJettonWallet.getGetWalletData();
    console.log(`Provider Jetton Wallet balance(before): ${walletDataBefore.balance.toString()}`);

    const amount = toNano(1n);

    await sleep(1000);
    await pool.send(
        provider.sender(),
        {
            value: toNano('0.25')
        },
        {
            $$type: 'BorrowToken',
            tokenAddress,
            amount: amount,
        }
    );

    await sleep(1000);
    let walletData = await providerJettonWallet.getGetWalletData();
    let i = 0;
    while (walletData.balance === walletDataBefore.balance && i < 20) {
        await sleep(1000);
        console.log('Waiting for balance update...');
        walletData = await providerJettonWallet.getGetWalletData();
        i++;
    }
    console.log(`Current Jetton Wallet balance: ${walletData.balance.toString()}`);

    console.log(`Borrow Jetton: ${amount.toString()} to Pool at ${pool.address.toString()}`);
}
