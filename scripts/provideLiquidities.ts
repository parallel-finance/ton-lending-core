import { address, beginCell, Cell, OpenedContract, Slice, toNano, Address } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';

const mintAndSupplyJetton = async (provider: NetworkProvider, pool: OpenedContract<Pool>, jettonAddress: Address) => {
    const sampleJetton = provider.open(SampleJetton.fromAddress(jettonAddress));
    const providerJettonWalletAddress = await sampleJetton.getGetWalletAddress(provider.sender().address!!);
    const providerJettonWallet = provider.open(JettonDefaultWallet.fromAddress(providerJettonWalletAddress));
    const userAddress = Address.parse(provider.sender().address?.toString() || '');

    console.log(`Start mint jetton ${jettonAddress.toString()} to ${userAddress.toString()}`);
    // mint jetton
    const amount = toNano(1000n);
    await sampleJetton.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'Mint',
            queryId: 0n,
            receiver: userAddress,
            amount: amount,
        }
    );

    await sleep(10000);
    console.log(`Mint ${amount} Jetton to ${userAddress.toString()}`);

    // supply jetton
    const forward_payload: Cell = beginCell().storeUint(0x55b591ba, 32).endCell();
    await providerJettonWallet.send(
        provider.sender(),
        {
            value: toNano('0.25'),
        },
        {
            $$type: 'TokenTransfer',
            queryId: 0n,
            amount: amount,
            destination: pool.address,
            response_destination: providerJettonWalletAddress,
            custom_payload: null,
            forward_ton_amount: toNano('0.15'),
            forward_payload: forward_payload,
        },
    );
    await sleep(10000);
    console.log(`Supply Jetton: ${amount.toString()} to Pool at ${pool.address.toString()}`);
}

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    const addresses = [
        address('EQBe9prUeNqHJHRw4YWDZhXI91kiGaGTTHuCWIaY975Uw2AU'),
        address('EQColXOG7C2X8x0ZFT-3Ot5sYknz-JbLnJzI1eVNldQlX2Bu'),
        address('EQD8-IT-fOEuBqY5bG_NY3lcZTKnnKv-7_UuILidV2eCa4W-'),
        address('EQBvOgGXLdZOysRTnw2UDc_KRwcD5HLVH139DZ3AnK04LcxH'),
    ];

    for (let i = 0; i < addresses.length; i++) {
        await mintAndSupplyJetton(provider, pool, addresses[i]);
    }
}
