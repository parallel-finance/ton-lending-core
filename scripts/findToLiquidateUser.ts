import { address, Address, OpenedContract, TupleBuilder } from '@ton/core';
import { Pool, ReserveData, storeTupleUserAccountData, UserAccountData, UserAccountHealthInfo } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';
import axios from 'axios';
import { UserAccount } from '../build/Pool/tact_UserAccount';
import { RAY } from '../helpers/constant';

declare global {
    interface BigInt {
        toJSON(): string;
    }
}

BigInt.prototype.toJSON = function () {
    return this.toString();
};

declare global {
    class Address {
        toJSON(): string;
    }
}

// @ts-ignore
Address.prototype.toJSON = function () {
    return this.toString();
};

// Use hardcode reserve addresses to reduce the rpc calls
const reserveAddresses = [

];

type ReserveInfo = {
    aTokenAddress: Address;
    dTokenAddress: Address;
    reserveData: ReserveData;
}

type JettonHolderAddress = {
    address: string;
    owner: {
        address: string;
    };
    balance: string;
}

// use tonApiUrl for mainnet
const tonApiUrl = 'https://tonapi.io';
const testnetTonApiUrl = 'https://testnet.tonapi.io';

export const testTonApi = async () => {
    const accountId= '0:d1b8300f97cb82747ad1fd73321b52af289317afae361cc78764f679276f99e1';
    const query = `/v2/jettons/${accountId}/holders?limit=${1000}&offset=${0}`;
    const testUrl = `${testnetTonApiUrl}${query}`;
    const result = await axios.get(testUrl);
    console.log(result.data);
}

const getUserHealthInfo = async (provider: NetworkProvider, pool: OpenedContract<Pool>, userAddress: Address) => {
    const poolAddress = pool.address;

    await sleep(1000);
    const userAccountContract = provider.open(await UserAccount.fromInit(poolAddress, userAddress));
    await sleep(1000);
    const userAccountData: UserAccountData = await userAccountContract.getAccount();
    await sleep(1000);
    const userHealthInfo: UserAccountHealthInfo = await pool.getUserAccountHealthInfo(userAccountData);
    return userHealthInfo;
}

async function getAllReserves(pool: OpenedContract<Pool>) : Promise<Record<string, ReserveInfo>>{
    await sleep(1000);
    const reserves: Record<string, ReserveInfo> = {};
    const reserveLength = await pool.getReservesLength();
    console.log(`Current reserve length: ${reserveLength.toString()}`);
    for (let i = 0; i < reserveLength; i++) {
        await sleep(1000);
        console.log(`Reserve index: ${i}`);
        const reserveAddress = await pool.getReserveAddress(BigInt(i));
        console.log(`Reserve address: ${reserveAddress.toString()}`);

        await sleep(1000);
        const configuration = await pool.getReserveConfiguration(reserveAddress);
        const aTokenAddress = configuration.aTokenAddress;
        const dTokenAddress = configuration.dTokenAddress;
        await sleep(1000);
        const reserveData = await pool.getReserveData(reserveAddress);
        reserves[reserveAddress.toString()] = {
            aTokenAddress,
            dTokenAddress,
            reserveData,
        };
    }
    return reserves;
}

export const getUniqueDTokenHolders = async (reserves: Record<string, ReserveInfo>): Promise<Address[]> => {
    // Get all dToken holders
    const holdersArray = await Promise.all(Object.keys(reserves).map(async (reserveAddress) => {
        const { dTokenAddress } = reserves[reserveAddress];
        // use ton api to get jetton holders
        const limit = 1000;
        let offset = 0;
        let holders: Address[] = [];
        const accountId = dTokenAddress.toRawString();
        const query = `/v2/jettons/${accountId}/holders?limit=${limit}&offset=${offset}`;
        const url = `${testnetTonApiUrl}${query}`;
        try {
            const result = await axios.get(url);
            if (result.data.total > 0) {
                holders = result.data.addresses.map((addressData: JettonHolderAddress) => address(addressData.owner.address));
            }
        } catch (e) {
            // It means the dToken has no holders
        }
        return holders;
    }));

    // Merge and unique all dToken holders
    return Array.from(new Set(holdersArray.flat()));
}

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    const reserves = await getAllReserves(pool);

    // Get all dToken holders
    const uniqueHolders = await getUniqueDTokenHolders(reserves);
    const liquidatableUsers: Address[] = [];

    for (let i = 0; i < uniqueHolders.length; i++) {
        const userHealthInfo = await getUserHealthInfo(provider, pool, uniqueHolders[i]);
        const {totalCollateralInBaseCurrency, healthFactorInRay} = userHealthInfo;
        if (totalCollateralInBaseCurrency > 0 && healthFactorInRay < RAY) {
            console.log(`User ${uniqueHolders[i].toString()} is liquidatable`);
            liquidatableUsers.push(uniqueHolders[i]);
        } else {
            console.log(`User ${uniqueHolders[i].toString()} is not liquidatable`);
        }
    }
    console.log(`Liquidatable users: ${liquidatableUsers.map((address) => address.toString()).join(', ')}`);
}

