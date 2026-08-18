// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SSTORE2} from "solady/src/utils/SSTORE2.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title M2 spike — throwaway. Purpose: prove the core thesis before building on it.
/// 1. Can we SSTORE2 a ~20KB image blob?
/// 2. What does it actually cost, vs the 4.6M gas the model predicts?
/// 3. Can a view function read it back and base64 it for free?
/// Deliberately ugly. Deleted once the real contract lands.
contract SpikeSSTORE2 {
    address public pointer;
    uint256 public storedLength;

    /// EIP-170 caps deployed bytecode at 24576 bytes, so one pointer holds <= 24KB.
    /// Solady reverts with an opaque DeploymentFailed(); we check first for a clear error.
    uint256 public constant MAX_IMAGE_BYTES = 24_000;

    error ImageTooLarge(uint256 got, uint256 max);

    function store(bytes calldata data) external {
        if (data.length > MAX_IMAGE_BYTES) {
            revert ImageTooLarge(data.length, MAX_IMAGE_BYTES);
        }
        pointer = SSTORE2.write(data);
        storedLength = data.length;
    }

    /// Read raw bytes back.
    function readRaw() external view returns (bytes memory) {
        return SSTORE2.read(pointer);
    }

    /// The thesis: base64 inside a view function is FREE — nobody pays for eth_call.
    /// If this works, we store raw bytes on-chain and never store base64.
    function readAsDataUri() external view returns (string memory) {
        bytes memory raw = SSTORE2.read(pointer);
        return string.concat("data:image/webp;base64,", Base64.encode(raw));
    }

    /// Full end-to-end shape: an SVG with the image embedded, wrapped in JSON metadata.
    function fullTokenURI() external view returns (string memory) {
        bytes memory raw = SSTORE2.read(pointer);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">',
            '<rect width="600" height="800" fill="#0d1117"/>',
            '<image x="100" y="100" width="400" height="400" href="data:image/webp;base64,',
            Base64.encode(raw),
            '"/>',
            '<text x="300" y="600" fill="#fff" font-size="32" text-anchor="middle">SPIKE TEST</text>',
            "</svg>"
        );
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(string.concat(
                '{"name":"Spike","description":"M2 gas spike","image":"data:image/svg+xml;base64,',
                Base64.encode(bytes(svg)),
                '"}'
            )))
        );
    }
}
