import { Address, toNano } from '@ton/core';
import { NetworkProvider, sleep } from '@ton/blueprint';
import {SampleJetton} from "../build/SampleJetton/tact_SampleJetton";

export async function run(provider: NetworkProvider, args: string[]) {
    const userAddress = Address.parse(provider.sender().address?.toString() || '');
    const ui= provider.ui();

    // MAS: EQBe9prUeNqHJHRw4YWDZhXI91kiGaGTTHuCWIaY975Uw2AU
    // USDT: EQColXOG7C2X8x0ZFT-3Ot5sYknz-JbLnJzI1eVNldQlX2Bu
    // NOT: EQD8-IT-fOEuBqY5bG_NY3lcZTKnnKv-7_UuILidV2eCa4W-
    // pTON: EQBvOgGXLdZOysRTnw2UDc_KRwcD5HLVH139DZ3AnK04LcxH
    const address = Address.parse(args.length > 0 ? args[0] : await ui.input('SampleJetton address'));

    if (!(await provider.isContractDeployed(address))) {
        ui.write(`Error: Contract at address ${address} is not deployed!`);
        return;
    }

    const sampleJetton = provider.open(SampleJetton.fromAddress(address));

    await sampleJetton.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'Mint',
            queryId: 0n,
            receiver: userAddress,
            amount: toNano("10000"),
        }
    );
    console.log(`Minted 10000 token to ${userAddress.toString()}`);
}
