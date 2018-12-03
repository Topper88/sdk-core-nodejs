/*
 * @Author: XY | The Findables Company <ryanxyo>
 * @Date:   Tuesday, 20th November 2018 10:18:42 am
 * @Email:  developer@xyfindables.com
 * @Filename: index.ts
 * @Last modified by: ryanxyo
 * @Last modified time: Wednesday, 21st November 2018 10:06:05 am
 * @License: All Rights Reserved
 * @Copyright: Copyright XY | The Findables Company
 */

/**
 * Some very important numbers that factor into the catalogue negotiation protocol
 */

/** The current number of bytes that encode the length if the catalogue */
export const CATALOGUE_LENGTH_IN_BYTES = 4

/** This number of bytes allowed to encode how big the catalogue can be */
export const CATALOGUE_SIZE_OF_SIZE_BYTES = 1

/**
 * When a payload is passed it is padded with the length of bytes of the payload.
 * It gets 4 bytes to do so
 */
export const CATALOGUE_SIZE_OF_PAYLOAD_BYTES = 4

/**
 * The catalogue items this node knows about
 */
export enum CatalogueItem  {
  BOUND_WITNESS = Math.pow(2, 0),
  TAKE_ORIGIN_CHAIN = Math.pow(2, 1),
  GIVE_ORIGIN_CHAIN = Math.pow(2, 2)
}

/**
 * A utility function for translating a buffer to a list of catalogues items
 * that another node is willing to do.
 *
 * @param buffer The data buffer to read and translate
 */

export function bufferToCatalogueItems(buffer: Buffer): CatalogueItem[] {
  if (buffer.length < 4) {
    return []
  }

  const values = buffer.readUInt32BE(0)

  return [
    (CatalogueItem.BOUND_WITNESS & values) > 0 ? CatalogueItem.BOUND_WITNESS : null,
    (CatalogueItem.TAKE_ORIGIN_CHAIN & values) > 0 ? CatalogueItem.TAKE_ORIGIN_CHAIN : null,
    (CatalogueItem.GIVE_ORIGIN_CHAIN & values) > 0 ? CatalogueItem.GIVE_ORIGIN_CHAIN : null
  ]
  .filter(catalogueItem => catalogueItem !== null) as CatalogueItem[]
}

/** Returns a number, which is feature-mask representing CatalogueItems */
export function catalogueItemsToMask(catalogueItems: CatalogueItem[]) {
  return catalogueItems.reduce((sum, item) => sum + item, 0)
}

/**
 * The necessary communication interfaces that xyo-nodes will
 * use to communicate to other nodes on a `network`
 */

/**
 * A peer, meant to represent the meaningful attributes of the
 * node on the other side of the network pipe
 */
export interface IXyoNetworkPeer {

  /**
   * Returns an id for a peer that should be consistent across multiple connections
   * to the same node
   */
  getTemporaryPeerId(): Buffer
}

/**
 * An interface that allows the network to delegate to implementer of
 * this interface as to which operations the xyo-node supports
 */
export interface IXyoNetworkProcedureCatalogue {

  /**
   * Since not all operations are symmetric, a `canDo` interface
   * is required so that an XyoNode can agree to partake in operation
   * where one party is one role and the other party is the other role.
   *
   * For example, an archivist can take origin-chains but does not
   * want to give origin-chains. So if an archivist is queried with
   * `canDo(TAKE_ORIGIN_CHAIN)` it should return true
   */

  canDo(catalogueItem: CatalogueItem): boolean

  /**
   * The list of current `CatalogueItems` the `XyoNode` can perform
   */

  getCurrentCatalogue(): CatalogueItem[]
}

/**
 * An XyoNetworkPipe is a communication channel between two
 * nodes and will be used the fundamental way that two
 * nodes communicate with one another
 */
export interface IXyoNetworkPipe {

  /** A representation of the peer on the other side of the pipe */
  peer: IXyoNetworkPeer

  /** The catalogue of operations that the peer can perform */
  otherCatalogue: CatalogueItem[] | undefined

  /** Any data that was initially passed to start an interaction */
  initiationData: Buffer | undefined

  /** A consumer may register a handler for when the other peer disconnects */
  onPeerDisconnect(callback: (hasError: boolean) => void): () => void

  /** Sends message to the peer. If awaitResponse is true it will wait for a message from the other node */
  send (data: Buffer, awaitResponse?: boolean): Promise<Buffer | undefined>

  /** Closes the connection to the peer */
  close(): Promise<void>
}

/**
 * A network-provider will try to find peers who are compatible with the catalogue passed in.
 * Once a peer is found, it returns a pipe to send messages on.
 */
export interface IXyoNetworkProvider {

  /** Attempts to find a peer with a compatible catalogue. */
  find(catalogue: IXyoNetworkProcedureCatalogue): Promise<IXyoNetworkPipe>

  /** Tells the network-provider to stop finding peers */
  stopServer(): Promise<void>
}