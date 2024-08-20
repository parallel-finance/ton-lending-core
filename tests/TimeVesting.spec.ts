import { Blockchain, BlockchainSnapshot, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { address, Address, beginCell, Cell, Dictionary, DictionaryKeyTypes, fromNano, toNano } from '@ton/core';
import '@ton/test-utils';
import { buildOnchainMetadata } from '../scripts/utils';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { flattenTransaction } from '@ton/test-utils';
import { MockTay } from '../wrappers/MockTay';
import { TimeVestingMaster } from '../wrappers/TimeVestingMaster';
import { TimeVesting } from '../wrappers/TimeVesting';
import { sleep } from '@ton/blueprint';

describe('TimeVesting test', () => {
    let blockchain: Blockchain;
    let snapshot: BlockchainSnapshot;
    let deployer: SandboxContract<TreasuryContract>;
    let secondUser: SandboxContract<TreasuryContract>;
    let tay: SandboxContract<MockTay>;
    let timeVestingMaster: SandboxContract<TimeVestingMaster>;
    let addresses: any = {};

    jest.setTimeout(60 * 1000);

    beforeAll(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        addresses.deployer = deployer.address;
        secondUser = await blockchain.treasury('secondUser');
        addresses.secondUser = secondUser.address;

        const jettonParams = {
            name: 'TonLayer Token',
            description: 'TonLayer Token',
            image: '',
            symbol: 'TAY',
            decimals: '9',
        };
        // 1B
        let max_supply = 1000000000n * 10n ** 9n;
        let content = buildOnchainMetadata(jettonParams);

        tay = blockchain.openContract(await MockTay.fromInit(deployer.address, content, max_supply));

        await tay.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );

        timeVestingMaster = blockchain.openContract(await TimeVestingMaster.fromInit());
        await timeVestingMaster.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );
        addresses.timeVestingMaster = timeVestingMaster.address;
        const timeVestingMasterTayWallet = await tay.getGetWalletAddress(timeVestingMaster.address);
        await timeVestingMaster.send(
            deployer.getSender(),
            {
                value: toNano('0.5'),
            },
            {
                $$type: 'SetTayWallet',
                tayWallet: timeVestingMasterTayWallet,
            },
        );
        const timeVestingMasterData = await timeVestingMaster.getTimeVestingMasterData();
        addresses.timeVestingMasterTayWallet = timeVestingMasterTayWallet;
        expect(timeVestingMasterData.tayWallet).toEqualAddress(timeVestingMasterTayWallet);
        expect(timeVestingMasterData.owner).toEqualAddress(deployer.address);
        expect(timeVestingMasterData.stopped).toEqual(false);

        const mintMockTay = async (jetton: SandboxContract<MockTay>, receiver: Address, amount: bigint) => {
            await jetton.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'Mint',
                    queryId: 0n,
                    amount,
                    receiver,
                },
            );
        };

        await mintMockTay(tay, deployer.getSender().address, toNano(100000n));
        await mintMockTay(tay, secondUser.getSender().address, toNano(100000n));
    });

    beforeEach(async () => {
        snapshot = blockchain.snapshot();
    });
    afterEach(async () => {
        await blockchain.loadFrom(snapshot);
        priceAddresses();
    });

    const priceAddresses = () => {
        const printAddress: any = {};
        Object.entries(addresses).forEach(([key, value]) => {
            printAddress[key] = (value as Address).toString();
        });
        // console.table(printAddress);
    };

    const setVestingPeriod = async (vestingPeriod: bigint) => {
        const result = await timeVestingMaster.send(
            deployer.getSender(),
            {
                value: toNano('0.5'),
            },
            {
                $$type: 'SetVestingPeriod',
                vestingPeriod,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: timeVestingMaster.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: timeVestingMaster.address,
            to: deployer.address,
            success: true,
        });
        expect((await timeVestingMaster.getTimeVestingMasterData()).vestingPeriod).toEqual(vestingPeriod);
    };

    const addLock = async (amount: bigint) => {
        const deployerJettonWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await tay.getGetWalletAddress(deployer.address)),
        );
        const deployerTimeVesting = blockchain.openContract(
            TimeVesting.fromAddress(await timeVestingMaster.getUserTimeVestingAddress(deployer.address)),
        );
        const timeVestingMasterTayWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(addresses.timeVestingMasterTayWallet),
        );
        const masterBalanceBefore =
            (await blockchain.provider(timeVestingMasterTayWallet.address).getState()).state.type === 'uninit'
                ? 0n
                : (await timeVestingMasterTayWallet.getGetWalletData()).balance;
        // utils.calculateRequestOpcode_1("AddLock")
        const forward_payload: Cell = beginCell().storeUint(0x63ed65e, 32).endCell();
        const messageSender = deployer.getSender();
        let result = await deployerJettonWallet.send(
            messageSender,
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 0n,
                amount,
                destination: timeVestingMaster.address,
                response_destination: messageSender.address,
                custom_payload: null,
                // Notice: forward_ton_amount is at least 0.04
                // the first `addLock` will pay the extra storage fee,
                // And after the first, the real gas cost of `addLock` is about 0.017513, and will cashback 0.007943 to user
                forward_ton_amount: toNano('0.04'),
                forward_payload,
            },
        );
        // printTransactionFees(result.transactions);
        expect(result.transactions).toHaveTransaction({
            from: messageSender.address,
            to: deployerJettonWallet.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: addresses.timeVestingMasterTayWallet,
            success: true,
        });
        // TAY TokenNotification
        expect(result.transactions).toHaveTransaction({
            from: addresses.timeVestingMasterTayWallet,
            to: timeVestingMaster.address,
            success: true,
        });
        // AddLock
        expect(result.transactions).toHaveTransaction({
            from: timeVestingMaster.address,
            to: deployerTimeVesting.address,
            success: true,
        });
        const userLocks = await deployerTimeVesting.getTimeVestingData();
        expect(userLocks.locks.get(Number(userLocks.index) - 1)?.amount).toEqual(amount);
        const now = Math.floor(new Date().getTime() / 1000);
        expect(Number(userLocks.locks.get(Number(userLocks.index) - 1)?.releaseTime)).toBeCloseTo(
            now + Number((await timeVestingMaster.getTimeVestingMasterData()).vestingPeriod),
            -1,
        );
        const masterBalanceAfter = (await timeVestingMasterTayWallet.getGetWalletData()).balance;
        expect(masterBalanceAfter).toEqual(masterBalanceBefore + amount);
        // console.log(fromNano((await blockchain.provider(deployerTimeVesting.address).getState()).balance));
    };

    it('set time vesting period', async () => {
        await setVestingPeriod(2n);
    });

    it('timeVesting addLock', async () => {
        const amount = toNano(100n);
        await addLock(amount);
    });

    it('timeVesting addLock twice', async () => {
        const amount = toNano(100n);
        await addLock(amount);
        await addLock(amount);
        const deployerTimeVesting = blockchain.openContract(
            TimeVesting.fromAddress(await timeVestingMaster.getUserTimeVestingAddress(deployer.address)),
        );
        const userLocks = await deployerTimeVesting.getTimeVestingData();
        expect(userLocks.master).toEqualAddress(timeVestingMaster.address);
        expect(userLocks.owner).toEqualAddress(deployer.address);
        expect(userLocks.index).toEqual(2n);
        expect(userLocks.locks.size).toEqual(2);
        expect(userLocks.locks.get(0)?.amount).toEqual(amount);
        expect(userLocks.locks.get(1)?.amount).toEqual(amount);
    });

    it('timeVesting claim expired lock', async () => {
        const amount = toNano(100n);
        await setVestingPeriod(1n);
        await addLock(amount);
        await addLock(amount);
        await sleep(1000);
        const deployerTimeVesting = blockchain.openContract(
            TimeVesting.fromAddress(await timeVestingMaster.getUserTimeVestingAddress(deployer.address)),
        );
        const deployerJettonWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await tay.getGetWalletAddress(deployer.address)),
        );
        const deployerBalanceBefore = (await deployerJettonWallet.getGetWalletData()).balance;
        const lockIds = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Bool());
        lockIds.set(0, false);
        lockIds.set(1, false);
        lockIds.set(2, false);
        let result = await deployerTimeVesting.send(
            deployer.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'Claim',
                lockIds,
                bouncedAmount: 0n,
            },
        );
        // printTransactionFees(result.transactions);
        // console.log(fromNano((await blockchain.provider(deployerTimeVesting.address).getState()).balance));
        const userLocks = await deployerTimeVesting.getTimeVestingData();
        const deployerBalanceAfter = (await deployerJettonWallet.getGetWalletData()).balance;
        expect(deployerBalanceAfter).toEqual(deployerBalanceBefore + amount * 2n);
        expect(userLocks.locks.size).toEqual(0);
    });

    xit('simulate claim bounced', async () => {
        // add throw(999) to simulate LockClaimed error
        const amount = toNano(100n);
        await setVestingPeriod(1n);
        await addLock(amount);
        await addLock(amount);
        await sleep(1000);
        const deployerTimeVesting = blockchain.openContract(
            TimeVesting.fromAddress(await timeVestingMaster.getUserTimeVestingAddress(deployer.address)),
        );
        const deployerJettonWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await tay.getGetWalletAddress(deployer.address)),
        );
        const deployerBalanceBefore = (await deployerJettonWallet.getGetWalletData()).balance;
        const lockIds = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Bool());
        lockIds.set(0, false);

        let result = await deployerTimeVesting.send(
            deployer.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'Claim',
                lockIds,
                bouncedAmount: 0n,
            },
        );
        // printTransactionFees(result.transactions);
        // console.log(flattenTransaction(result.transactions[result.transactions.length - 1]));
        // console.log(fromNano((await blockchain.provider(deployerTimeVesting.address).getState()).balance));
        let userLocks = await deployerTimeVesting.getTimeVestingData();
        const deployerBalanceAfter = (await deployerJettonWallet.getGetWalletData()).balance;
        expect(deployerBalanceAfter).toEqual(deployerBalanceBefore);
        expect(userLocks.locks.size).toEqual(1);
        expect(userLocks.bouncedAmount).toEqual(amount);

        lockIds.set(1, false);
        result = await deployerTimeVesting.send(
            deployer.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'Claim',
                lockIds,
                bouncedAmount: userLocks.bouncedAmount,
            },
        );
        // printTransactionFees(result.transactions);
        // console.log(flattenTransaction(result.transactions[result.transactions.length - 1]));
        // console.log(fromNano((await blockchain.provider(deployerTimeVesting.address).getState()).balance));
        userLocks = await deployerTimeVesting.getTimeVestingData();
        expect(userLocks.locks.size).toEqual(0);
        expect(userLocks.bouncedAmount).toEqual(amount * 2n);
    });
});
