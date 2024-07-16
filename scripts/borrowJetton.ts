import { address, beginCell, Cell, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider } from '@ton/blueprint';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    const tokenAddress = address('EQCP_v_hh0uTHIG_j6jpynQhazw3m1ZyEPR_aQMQTAsHMPxA');
    const sampleJetton = provider.open(SampleJetton.fromAddress(tokenAddress));
    const providerJettonWalletAddress = await sampleJetton.getGetWalletAddress(provider.sender().address!!);
    const providerJettonWallet = provider.open(JettonDefaultWallet.fromAddress(providerJettonWalletAddress));
    const walletDataBefore = await providerJettonWallet.getGetWalletData();
    console.log(`Provider Jetton Wallet balance(before): ${walletDataBefore.balance.toString()}`);

    const amount = toNano(1n);

    const forward_payload: Cell = beginCell()
        .storeUint(0x55b591ba, 32)
        .endCell();

    await pool.send(
        provider.sender(),
        {
            value: toNano('0.15')
        },
        {
            $$type: 'BorrowToken',
            tokenAddress,
            amount: amount,
        }
    );

    let walletData = await providerJettonWallet.getGetWalletData();
    let i = 0;
    while (walletData.balance === walletDataBefore.balance && i < 20) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('Waiting for balance update...');
        walletData = await providerJettonWallet.getGetWalletData();
        i++;
    }
    console.log(`Current Jetton Wallet balance: ${walletData.balance.toString()}`);

    console.log(`Borrow Jetton: ${amount.toString()} to Pool at ${pool.address.toString()}`);
}
