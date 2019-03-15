/*
 * @Author: XY | The Findables Company <ryanxyo>
 * @Date:   Monday, 25th February 2019 10:15:15 am
 * @Email:  developer@xyfindables.com
 * @Filename: xyo-scsc-consensus-provider.ts
 * @Last modified by: ryanxyo
 * @License: All Rights Reserved
 * @Copyright: Copyright XY | The Findables Company
 */

import { IConsensusProvider, IStake, IRequest, ISignatureComponents, IResponse, IRewardComponents, IRequestType } from './@types'
import { BN, base58 } from '@xyo-network/utils'
import { XyoBase } from '@xyo-network/base'
import { XyoWeb3Service } from '@xyo-network/web3-service'
import { soliditySHA3, solidityPack } from 'ethereumjs-abi'
import { XyoError, XyoErrors } from '@xyo-network/errors'

export class XyoScscConsensusProvider extends XyoBase implements IConsensusProvider {

  private static CONFIRMATION_THRESHOLD = 24

  private web3Service: XyoWeb3Service

  constructor(private readonly web3: XyoWeb3Service) {
    super()
    this.web3Service = web3
  }

  public async getBlockHeight(): Promise<BN> {
    const web3 = await this.web3Service.getOrInitializeWeb3()
    const blockNumber = await web3.eth.getBlockNumber()
    return this.coerceBN(blockNumber)
  }

  public async getBlockConfirmationTrustThreshold(): Promise<number> {
    return XyoScscConsensusProvider.CONFIRMATION_THRESHOLD
  }

  public async getRequestById(id: string, blockHeight?: BN): Promise<IRequest | undefined> {
    const consensus = await this.web3Service.getOrInitializeSC("XyStakingConsensus")
    const req = await consensus.methods.requestsById(id).call({}, blockHeight)
    if (!req.createdAt || req.createdAt === '0') {
      return undefined
    }
    return req
  }

  public async getNextUnhandledRequests(blockHeight?: BN): Promise<{ [id: string]: IRequest }> {
    const resultMapping: { [id: string]: IRequest } = {}
    const consensus = await this.web3Service.getOrInitializeSC("XyStakingConsensus")
    const numRequests = await consensus.methods.numRequests().call({}, blockHeight)
    return this.getUnhandledRequestsBatch(resultMapping, numRequests, blockHeight)
  }

  public async getLatestBlockHash(blockHeight?: BN): Promise<string> {
    const consensus = await this.web3Service.getOrInitializeSC("XyStakingConsensus")
    const result = await consensus.methods.getLatestBlock().call({}, blockHeight)
    return result
  }

  public async getNetworkActiveStake(blockHeight?: BN): Promise<BN> {
    const consensus = await this.web3Service.getOrInitializeSC("XyStakingConsensus")
    const activeState = await consensus.methods.totalActiveStake().call({}, blockHeight)
    return this.coerceBN(activeState)
  }

  public async getActiveStake(paymentId: string, blockHeight?: BN): Promise<BN> {
    const consensus = await this.web3Service.getOrInitializeSC("XyStakingConsensus")
    const stakeeStake = await consensus.methods.stakeeStake(paymentId).call({}, blockHeight)
    return this.coerceBN(stakeeStake.activeStake)
  }

  public async getStakerActiveStake(
      paymentId: string,
      stakerAddr: string,
      blockHeight?: BN
    ): Promise<BN> {
    const consensus = await this.web3Service.getOrInitializeSC("XyStakingConsensus")
    const numStakerStakes = await consensus.methods.numStakerStakes(stakerAddr)
    const numStakeeStakes = await consensus.methods.numStakeeStakes(paymentId)

    const stakeIdPromises = []
    if (numStakerStakes < numStakeeStakes) {
      for (let i = 0; i < numStakerStakes; i++) {
        stakeIdPromises.push(consensus.methods.stakerToStakingIds(stakerAddr, i).call({}, blockHeight))
      }
    } else {
      for (let i = 0; i < numStakeeStakes; i++) {
        stakeIdPromises.push(consensus.methods.stakeeToStakingIds(paymentId, i).call({}, blockHeight))
      }
    }
    const stakeIds = await Promise.all(stakeIdPromises)

    if (stakeIds.length === 0) {
      return new BN(0)
    }
    const stakeFeches = stakeIds.map(async (id: any) => consensus.methods.stakeData(id))
    const stakeDatas = await Promise.all(stakeFeches)
    const activeStake = new BN(0)
    stakeDatas.forEach((stakeData: any) => {
      if (stakeData.staker === stakerAddr && stakeData.stakee === paymentId) {
        activeStake.add(stakeData.amount)
      }
    })
    return activeStake
  }

  public async isBlockProducer(paymentId: string, blockHeight?: BN): Promise<boolean> {
    const stakable = await this.web3Service.getOrInitializeSC("XyBlockProducer")
    return stakable.methods.exists(paymentId).call({}, blockHeight)
  }

  public async getRewardPercentages(blockHeight?: BN): Promise<IRewardComponents> {
    const governance = await this.web3Service.getOrInitializeSC("XyGovernance")
    // TODO load the Paramaterizer contract instead
    const bpReward = await governance.methods.get('xyBlockProducerRewardPct').call({}, blockHeight)
    const rewardComponents: IRewardComponents = {
      blockProducers: bpReward.value,
      supporters: 100 - bpReward.value
    }
    return rewardComponents
  }

  public async getNumRequests(blockHeight?: BN): Promise<number> {
    const consensus = await this.web3Service.getOrInitializeSC("XyStakingConsensus")
    return consensus.methods.numRequests().call({}, blockHeight)
  }

  public async getNumBlocks(blockHeight?: BN): Promise<number> {
    const consensus = await this.web3Service.getOrInitializeSC("XyStakingConsensus")
    return consensus.methods.numBlocks().call({}, blockHeight)
  }

  public async getExpectedGasRefund(requestIds: string[]): Promise<BN> {
    const requests = await this.getRequests(requestIds)
    const total = new BN(0)
    requests.forEach((req) => {
      total.add(req.weiMining)
    })
    return total
  }

  public async getMinimumXyoRequestBounty(blockHeight?: BN): Promise<BN> {
    return this.getGovernanceParam("xyXYORequestBountyMin", blockHeight)
  }

  public async getStakeQuorumPct(blockHeight?: BN): Promise<number> {
    const pct = await this.getGovernanceParam("xyStakeQuorumPct", blockHeight)
    return pct.toNumber()
  }

  public async encodeBlock(
    previousBlock: string,
    agreedStakeBlockHeight: BN,
    requests: string[],
    supportingData: string,
    responses: Buffer
  ): Promise<string> {

    const bytes32Arr = requests.map(() => "bytes32")
    const hexIpfsSupportingData = this.getBytes32FromIpfsHash(supportingData)
    const args = [
      previousBlock,
      agreedStakeBlockHeight.toString(),
      ...requests.map(r => this.getBytes32FromIpfsHash(r)),
      hexIpfsSupportingData,
      responses
    ]
    const hash = this.solidityHashString(
      [`bytes32`, `uint`, ...bytes32Arr, `bytes32`, `bytes`],
      args
      )
    const packedBytesCheck = this.solidityPackString(
      [`bytes32`, `uint`, ...bytes32Arr, `bytes32`, `bytes`],
      args
    )
    return hash
  }

  public async signBlock(block: string): Promise<ISignatureComponents> {
    this.logInfo(`Sign Block ${block}`)
    const signedMessage = await this.web3Service.signMessage(block)
    const sig = signedMessage
    // TODO Clean (this is broken in web3 beta 48):
    const r = `${sig.slice(0, 66)}`
    const s = `0x${sig.slice(66, 130)}`
    const v = parseInt(sig.slice(130, 132), 16)
    const signature: ISignatureComponents = {
      sigR:r, sigS: s, sigV:v, publicKey: this.web3Service.accountAddress}

    return signature
  }

  public async submitBlock(
    previousBlock: string,
    agreedStakeBlockHeight: BN,
    requests: string[],
    supportingData: string,
    responses: Buffer,
    signers: string[],
    sigR: string[],
    sigS: string[],
    sigV: number[]
  ): Promise<string> {
    const args = [
      previousBlock,
      agreedStakeBlockHeight.toString(),
      requests.map(r => this.getBytes32FromIpfsHash(r)),
      this.getBytes32FromIpfsHash(supportingData),
      responses,
      signers,
      sigR,
      sigS,
      sigV
    ]
    const bytes32Arr = requests.map(() => "bytes32")

    const check = this.solidityPackString(
      [`bytes32`, `uint`, ...bytes32Arr, `bytes32`, `bytes`],
      [
        previousBlock,
        agreedStakeBlockHeight.toString(),
        ...requests.map(r => this.getBytes32FromIpfsHash(r)),
        this.getBytes32FromIpfsHash(supportingData),
        responses
      ]
    )
    try {
      const consensus = await this.web3Service.getOrInitializeSC("XyStakingConsensus")
      const data = consensus.methods.submitBlock(...args).encodeABI()
      // const response = await this.web3Service.callRawTx({ data, to: consensus.address })
      // const response = await consensus.methods.submitBlock(...args)
      //        .send({ from: this.web3Service.accountAddress, gas: 3721975})
      // return response

      const tx = await this.web3Service.sendRawTx({ data, to: consensus.address })
      this.logInfo("Got Transaction!!!", tx)

      const newBlock = await this.decodeLogs(tx.logs[0].data, tx.logs[0].topics)

      return newBlock
    } catch (e) {
      throw new XyoError(`Submit block was reverted ${e}`, XyoErrors.CRITICAL)
    }
  }

  public createResponses(responses: IResponse[]): Buffer {
    const responseTypes = responses.map(r => r.boolResponse ? 'bool' : 'uint')
    const responseValues = responses.map(r => r.boolResponse ?
      r.boolResponse : r.numResponse ?
      r.numResponse : r.withdrawResponse)

    const packedBytes = solidityPack(
      [...responseTypes],
      [...responseValues]
    )

    return packedBytes
  }

  public async getStakesForStakee(paymentId: string, blockHeight?: BN): Promise<IStake[]> {
    const consensus = await this.web3Service.getOrInitializeSC("XyStakingConsensus")
    const numStakeeStakes = await consensus.methods.numStakeeStakes(paymentId)
    const stakeIdPromises = []
    for (let i = 0; i < numStakeeStakes; i++) {
      stakeIdPromises.push(consensus.methods.stakeeToStakingIds(paymentId, i).call({}, blockHeight))
    }
    return Promise.all(stakeIdPromises)
  }

  public async getGasEstimateForRequest(requestId: string): Promise<BN> {
    const req = await this.getRequestById(requestId)
    if (req) {
      const consensusAddress = this.web3Service.getAddressOfContract("XyStakingConsensus")
      const pOnD = await this.web3Service.getOrInitializeSC("XyPayOnDelivery")
      return pOnD.methods.submitResponse(consensusAddress, IRequestType.Bool, true).estimateGas()
    }
    return new BN(0)
  }

  public async canSubmitBlock(address: string, blockHeight?: BN): Promise<boolean> {
    return address === '0x60CE3c27395F35E21BC2c9AaAa2Db06a89e21b2C'
    return true
    // const stakable = await this.web3Service.getOrInitializeSC("XyBlockProducer")
    // const numProducers = await stakable.methods.numBlockProducers().call()
    // const stakee = this.solidityHashString([`address`],
    //   [address])
    // const bpIndex = await stakable.methods.blockProducerIndexes(stakee).call()
    // const numBlocks = await this.getNumBlocks(blockHeight)
    // return new BN(bpIndex).isEqualTo(new BN(numBlocks % numProducers))
  }

  private async decodeLogs(hexString: string, topics: [string]): Promise<string> {
    const web3 = await this.web3Service.getOrInitializeWeb3()

    const result = web3.eth.abi.decodeLog([{
      type: 'bytes32',
      name: 'blockHash'
    }, {
      type: 'bytes32',
      name: 'previousBlock'
    }, {
      type: 'uint256',
      name: 'createdAtBlock'
    }, {
      type: 'bytes32',
      name: 'payloadHash'
    }, {
      type: 'address',
      name: 'blockProducer'
    }],
      hexString,
      topics)

    return result.blockHash
  }

  private padLeft = (str: string, len: number) => this.web3Service.padLeft(str, len)

  private solidityHashString(types: string[], values: any[]): string {
    return `0x${soliditySHA3(
        types,
        values
      )
      .toString(`hex`)}`
  }

  private solidityPackString(types: string[], values: any[]): string {
    return `0x${solidityPack(
      types,
      values
    )
      .toString(`hex`)}`
  }

  private async getGovernanceParam(name: string, blockHeight?: BN): Promise<BN> {
    const governance = await this.web3Service.getOrInitializeSC("XyGovernance")
    const result = await governance.methods.get(name).call({}, blockHeight)
    return this.coerceBN(result.value | result)
  }

  private async getRequests(requestIds: string[], blockHeight?: BN): Promise<IRequest[]> {
    const idPromises = []
    // tslint:disable-next-line: prefer-for-of
    for (let i = 0; i < requestIds.length; i++) {
      const req: Promise<IRequest | undefined> = this.getRequestById(requestIds[i], blockHeight)
      if (req) {
        idPromises.push(
          req.then((r) => {
            if (!r) return
            r.xyoBounty = this.coerceBN(r.xyoBounty)
            r.weiMining = this.coerceBN(r.weiMining)
            return r
          })
        )
      }
    }
    const requestDatas = await Promise.all(idPromises)

    return requestDatas as IRequest[]
  }

  private coerceBN(val: BN | number | string): BN {
    if (val instanceof BN) return val
    if (typeof val === 'number') return new BN(val)
    if (typeof val === 'string') return new BN(val)

    throw new XyoError(`Could not parse BN ${val}`)
  }

  private getIpfsHashFromBytes32(bytes32Hex: string) {
    // Add our default ipfs values for first 2 bytes:
    // function:0x12=sha2, size:0x20=256 bits
    // and cut off leading "0x"
    const hashHex = `1220${bytes32Hex.slice(2).replace(/^0+/, '')}`
    const hashBytes = Buffer.from(hashHex, 'hex')
    const hashStr = base58.encode(hashBytes)
    return hashStr
  }

  private getBytes32FromIpfsHash(ipfsListing: string) {
    const sliceIndex = ipfsListing.startsWith('Qm') ? 2 : 0
    return `0x${base58.decode(ipfsListing).slice(sliceIndex).toString('hex')}`
  }

  private async getUnhandledRequestsBatch(
    unanswered: { [id: string]: IRequest },
    start: number,
    blockHeight?: BN
  ): Promise<{ [id: string]: IRequest }> {
    const consensus = await this.web3Service.getOrInitializeSC("XyStakingConsensus")

    const batchRequests = 30 // num requests in search scope from end of request list
    const maxTransactions = 20 // max number of transactions to return in full batch

    const numUnAnswered = Object.keys(unanswered).length
    if (numUnAnswered >= maxTransactions || start === 0) {
      return unanswered
    }
    const promises = []

    for (let i = start - 1; i >= 0 || promises.length >= batchRequests; i--) {
      promises.push(consensus.methods.requestChain(i).call({}, blockHeight))
    }

    const requestIds = await Promise.all(promises)
    const requests = await this.getRequests(requestIds)

    requests.map((req1, index) => {
      const req = req1 as IRequest
      if (!req.hasResponse && Object.keys(unanswered).length < maxTransactions) {
        const ipfsHash = this.getIpfsHashFromBytes32(requestIds[index])
        unanswered[ipfsHash] = req as IRequest
      }
    })
    return this.getUnhandledRequestsBatch(unanswered, start > batchRequests ? start - batchRequests : 0, blockHeight)
  }
}
