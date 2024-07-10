import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { address, toNano } from '@ton/core';
import { UserAccount } from '../wrappers/UserAccount';
import '@ton/test-utils';

describe('UserAccoount', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let userAccount: SandboxContract<UserAccount>;
    let reserveAddress = address('UQAEJ7U1iaC1TzcFel5lc2-JaEm8I0k5Krui3fzz3_GeANWV');

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        userAccount = blockchain.openContract(await UserAccount.fromInit(deployer.address, deployer.address));

        const deployResult = await userAccount.send(
            deployer.getSender(),
            {
                value: toNano('0.05')
            },
            {
                $$type: 'Deploy',
                queryId: 0n
            }
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: userAccount.address,
            deploy: true,
            success: true
        });
    });

    describe('updatePosition', () => {
        it('should init position successfully', async () => {
            const result = await userAccount.send(
                deployer.getSender(),
                {
                    value: toNano('0.05')
                },
                {
                    $$type: 'UpdatePosition',
                    address: reserveAddress,
                    supply: toNano('100'),
                    borrow: 0n,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: userAccount.address,
                success: true
            });

            const accountData = await userAccount.getAccount();
            expect(accountData.positionsLength).toBe(1n);
            expect(accountData.positions.get(0n)?.toString()).toEqual(reserveAddress.toString());
            expect(accountData.positionsDetail.get(reserveAddress)?.supply).toEqual(toNano('100'));
            expect(accountData.positionsDetail.get(reserveAddress)?.borrow).toEqual(0n);
        });

        it('should update position successfully', async () => {
            await userAccount.send(
                deployer.getSender(),
                {
                    value: toNano('0.05')
                },
                {
                    $$type: 'UpdatePosition',
                    address: reserveAddress,
                    supply: toNano('100'),
                    borrow: 0n,
                }
            );

            const result = await userAccount.send(
                deployer.getSender(),
                {
                    value: toNano('0.05')
                },
                {
                    $$type: 'UpdatePosition',
                    address: reserveAddress,
                    supply: -toNano('50'),
                    borrow: toNano(20n),
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: userAccount.address,
                success: true
            });

            const accountData = await userAccount.getAccount();
            expect(accountData.positionsLength).toBe(1n);
            expect(accountData.positions.get(0n)?.toString()).toEqual(reserveAddress.toString());
            expect(accountData.positionsDetail.get(reserveAddress)?.supply).toEqual(toNano(50));
            expect(accountData.positionsDetail.get(reserveAddress)?.borrow).toEqual(toNano(20n));
        });
    });

    describe('getters', () => {
        it('should get empty account data', async () => {
            const result = await userAccount.getAccount();
            console.log(result.positionsLength);
            expect(result).toMatchObject({
                $$type: 'UpdatePositionResponse',
                positionsLength: 0n,
                positions: {},
                positionsDetail: {},
            })
        });
    })
});
