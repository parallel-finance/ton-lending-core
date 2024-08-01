import { Address, Dictionary, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { OracleProvider } from '../wrappers/OracleProvider';
import { waitForTx } from '../helpers/address';

export async function run(provider: NetworkProvider, args: string[]) {
    console.log('add oracle feeder...');
    const ui = provider.ui();

    // const pool = provider.open(Pool.fromAddress(Address.parse("")))
    const pool = provider.open(await Pool.fromInit());
    // EQDsohOIWyDi3gGGaPQ5gllERwshyWe1t_6sn0afyDZgUVfj
    console.log('pool address: ', pool.address.toString());
    const oracleProvider = provider.open(await OracleProvider.fromInit(pool.address));
    console.log('oracleProvider address: ', oracleProvider.address.toString());
    await sleep(2000);

    const prices = Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigInt(256));
    const jetton = Address.parse('EQBe9prUeNqHJHRw4YWDZhXI91kiGaGTTHuCWIaY975Uw2AU')
    prices.set(jetton, toNano('1.34'));

    await oracleProvider.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'FeedPrices',
            prices,
        },
    );
    await waitForTx(provider, oracleProvider.address as Address, false);
    console.log(`feed price over`);
    console.log(
        `current price in oracle`, await oracleProvider.getPrice(jetton),
    );
    console.log(
        `current price in pool`, (await pool.getReserveData(jetton)).price,
    );
}
