/*
 * @Author: XY | The Findables Company <ryanxyo>
 * @Date:   Wednesday, 19th September 2018 9:00:03 am
 * @Email:  developer@xyfindables.com
 * @Filename: bound-witness-origin-chain-extractor.ts
 * @Last modified by: ryanxyo
 * @Last modified time: Thursday, 11th October 2018 4:50:58 pm
 * @License: All Rights Reserved
 * @Copyright: Copyright XY | The Findables Company
 */

import { XyoBoundWitness } from './xyo-bound-witness';
import { XyoBridgeBlockSet } from '../components/bridge-block-set/xyo-bridge-block-set';

/**
 * Bound witnesses can contain other bound-witnesses within their unsigned payload.
 * This is the fundamental way to bridge blocks in the Xyo protocol. This nesting
 * isn't necessarily one layer deep, it can be n-deep.
 *
 * This is a helper for recursively extracting the nested bound witnesses and flattening
 * them out.
 */

export function extractNestedBoundWitnesses(boundWitness: XyoBoundWitness) {
  const nestedBoundWitnesses: XyoBoundWitness[] = [];
  recursivelyExtractNestedBoundWitnesses(boundWitness, nestedBoundWitnesses);
  return nestedBoundWitnesses;
}

/**
 * Often bound-witness pass around origin-chains in their unsigned payloads so they can bridged or
 * archived. This helper function recursively extracts out those origin chains so they can be processed.
 */

function recursivelyExtractNestedBoundWitnesses(
  boundWitness: XyoBoundWitness,
  boundWitnessContainer: XyoBoundWitness[]
) {
  boundWitness.payloads.forEach((payload) => {
    payload.unsignedPayload.array.forEach((unsignedPayloadItem) => {
      const xyoObjectId = unsignedPayloadItem.id;
      if (
        xyoObjectId[0] === XyoBridgeBlockSet.major &&
        xyoObjectId[1] === XyoBridgeBlockSet.minor
      ) {
        const nestedBridgeBlockSet = unsignedPayloadItem as XyoBridgeBlockSet;
        nestedBridgeBlockSet.array.forEach((nestedObj) => {
          const nestedBoundWitness = nestedObj as XyoBoundWitness;
          boundWitnessContainer.push(nestedBoundWitness);
          recursivelyExtractNestedBoundWitnesses(nestedBoundWitness, boundWitnessContainer);
        });
      }
    });
  });
}