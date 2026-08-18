// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {SSTORE2} from "solady/src/utils/SSTORE2.sol";

/**
 * @title ExitBadge
 * @notice Fully on-chain ERC-721 completion badges for the ELCA EDI Challenge.
 *
 * Everything needed to render a badge lives on Polygon. tokenURI() assembles an
 * SVG from the stored fields and returns base64 JSON metadata — no IPFS, no
 * pinning service, no server. If every machine involved in building this
 * disappeared, the badges would still render.
 *
 * Two design points worth stating, since both look odd at first glance:
 *
 * 1. The recipient's image is stored as RAW BYTES and embedded in the SVG as a
 *    data URI. Referencing a remote URL (<image href="https://...">) does not
 *    work: browsers refuse to load external subresources inside an SVG rendered
 *    through an <img> tag, which is how wallets and marketplaces display NFTs.
 *    Embedding is what production on-chain projects (Nouns, Loot, Art Blocks)
 *    all do.
 *
 * 2. mint() is onlyOwner even though the application is public. The brief's
 *    openness requirement is about the WEB APP — no login, no wallet, no
 *    payment. Leaving mint() open to the world would let anyone bypass the
 *    app's rate limiting and drain the relayer that pays for gas. The public
 *    entry point is the website; the contract trusts only the relayer.
 */
contract ExitBadge is ERC721, Ownable {
    using Strings for uint256;

    /// @dev EIP-170 caps deployed bytecode at 24576 bytes, and SSTORE2 stores
    /// data AS bytecode, so one pointer holds slightly under 24KB. We check
    /// explicitly because Solady would otherwise revert with an opaque
    /// DeploymentFailed().
    uint256 public constant MAX_IMAGE_BYTES = 24_000;

    uint256 private constant MAX_NAME = 32;
    uint256 private constant MAX_PROJECT = 64;
    uint256 private constant MAX_DATE = 10;
    uint256 private constant MAX_DETAILS = 200;

    struct Badge {
        string firstName;
        string lastName;
        string mainProject;
        string startDate;      // YYYY-MM-DD, display-only: storing a timestamp
        string completionDate; // would force date formatting in Solidity for
                               // zero benefit.
        string details;
        address imagePointer;  // SSTORE2 pointer to the raw image bytes
        uint8 imageMime;       // 0=webp 1=png 2=jpeg — keeps format fallback
                               // a one-line change if a wallet dislikes webp
    }

    mapping(uint256 => Badge) private _badges;
    uint256 private _nextId = 1;

    error ImageTooLarge(uint256 got, uint256 max);
    error ImageEmpty();
    error FieldTooLong(string field, uint256 got, uint256 max);
    error IllegalCharacter(string field);
    error InvalidRecipient();
    error UnknownMime(uint8 got);
    error NonexistentToken(uint256 tokenId);

    event BadgeMinted(uint256 indexed tokenId, address indexed recipient, string project);

    constructor(address initialOwner) ERC721("ELCA Completion Badge", "ELCAB") Ownable(initialOwner) {}

    // ---------------------------------------------------------------- minting

    /**
     * @notice Mint a badge to `to`, storing every field needed to render it.
     * @dev Takes a struct rather than eight loose arguments. With this many
     * strings the compiler hits "stack too deep" otherwise — a struct occupies
     * one stack slot instead of eight.
     */
    function mint(address to, Badge calldata badge, bytes calldata image)
        external
        onlyOwner
        returns (uint256 tokenId)
    {
        // A token minted to address(0) is unrecoverable, and ERC721 would
        // revert anyway — this gives a clearer error.
        if (to == address(0)) revert InvalidRecipient();
        if (image.length == 0) revert ImageEmpty();
        if (image.length > MAX_IMAGE_BYTES) revert ImageTooLarge(image.length, MAX_IMAGE_BYTES);
        if (badge.imageMime > 2) revert UnknownMime(badge.imageMime);

        // Validate on the way IN. The same stored string is later interpolated
        // into both an XML document and a JSON string, and no single escaping
        // is correct for both contexts (&amp; is right for XML, wrong inside
        // JSON). Excluding the metacharacters at the boundary makes every
        // future read path safe by construction rather than by remembering to
        // escape. mint() runs once; tokenURI() may run thousands of times.
        _check(badge.firstName, "firstName", MAX_NAME);
        _check(badge.lastName, "lastName", MAX_NAME);
        _check(badge.mainProject, "mainProject", MAX_PROJECT);
        _check(badge.startDate, "startDate", MAX_DATE);
        _check(badge.completionDate, "completionDate", MAX_DATE);
        _check(badge.details, "details", MAX_DETAILS);

        tokenId = _nextId++;

        _badges[tokenId] = Badge({
            firstName: badge.firstName,
            lastName: badge.lastName,
            mainProject: badge.mainProject,
            startDate: badge.startDate,
            completionDate: badge.completionDate,
            details: badge.details,
            imagePointer: SSTORE2.write(image),
            imageMime: badge.imageMime
        });

        _safeMint(to, tokenId);
        emit BadgeMinted(tokenId, to, badge.mainProject);
    }

    /// @dev Reverts unless `s` is within `max` bytes and free of characters that
    /// are structural in XML or JSON.
    function _check(string calldata s, string memory field, uint256 max) private pure {
        bytes calldata b = bytes(s);
        if (b.length > max) revert FieldTooLong(field, b.length, max);
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (
                c < 0x20 ||          // control characters
                c == 0x7f ||         // DEL
                c == "<" || c == ">" || c == "&" ||  // XML structural
                c == '"' || c == "\\"                // JSON structural
            ) revert IllegalCharacter(field);
        }
    }

    // --------------------------------------------------------------- metadata

    function totalMinted() external view returns (uint256) {
        return _nextId - 1;
    }

    /// @notice Raw badge fields, so a gallery can read badges without decoding
    /// the whole data URI.
    function badgeOf(uint256 tokenId) external view returns (Badge memory) {
        _requireMinted(tokenId);
        return _badges[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireMinted(tokenId);
        Badge storage b = _badges[tokenId];

        // Note: no gas optimisation below this line. tokenURI is a view
        // function — it is served by eth_call and nobody pays for it — so
        // readability wins over cleverness.
        string memory svg = _buildSVG(b);

        string memory json = string.concat(
            '{"name":"', b.firstName, " ", b.lastName, " - ", b.mainProject,
            '","description":"On-chain completion badge issued via the ELCA EDI Challenge. Rendered entirely from on-chain data.',
            '","image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)),
            '","attributes":', _attributes(b), "}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _attributes(Badge storage b) private view returns (string memory) {
        return string.concat(
            '[{"trait_type":"Project","value":"', b.mainProject, '"},',
            '{"trait_type":"Start Date","value":"', b.startDate, '"},',
            '{"trait_type":"Completion Date","value":"', b.completionDate, '"},',
            '{"trait_type":"Recipient","value":"', b.firstName, " ", b.lastName, '"},',
            '{"trait_type":"Storage","value":"Fully On-Chain"}]'
        );
    }

    // ------------------------------------------------------------------- SVG

    /// @dev Mirrors shared/badge-template.ts byte for byte. A test decodes this
    /// output and string-compares it against the TypeScript implementation, so
    /// the live preview and the minted badge cannot silently diverge.
    function _buildSVG(Badge storage b) private view returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">',
            '<rect width="600" height="800" fill="#0B1A2F"/>',
            '<rect x="0" y="0" width="600" height="8" fill="#E2001A"/>',
            '<text x="60" y="70" fill="#F5F7FA" font-family="Helvetica,Arial,sans-serif" font-size="13" letter-spacing="3">COMPLETION BADGE</text>',
            '<line x1="60" y1="96" x2="540" y2="96" stroke="#1E3A5F" stroke-width="1"/>',
            '<rect x="98" y="130" width="404" height="404" fill="#122A47"/>',
            _svgImage(b),
            _svgText(b),
            _svgDetails(b),
            '<text x="60" y="770" fill="#1E3A5F" font-family="Helvetica,Arial,sans-serif" font-size="12" letter-spacing="2">POLYGON \xc2\xb7 ERC-721 \xc2\xb7 FULLY ON-CHAIN</text>',
            "</svg>"
        );
    }

    /// @dev Split out to keep each function's stack frame shallow.
    function _svgImage(Badge storage b) private view returns (string memory) {
        return string.concat(
            '<image x="100" y="132" width="400" height="400" preserveAspectRatio="xMidYMid slice" href="data:',
            _mime(b.imageMime),
            ";base64,",
            Base64.encode(SSTORE2.read(b.imagePointer)),
            '"/>'
        );
    }

    function _svgText(Badge storage b) private view returns (string memory) {
        return string.concat(
            '<text x="60" y="600" fill="#F5F7FA" font-family="Helvetica,Arial,sans-serif" font-size="38" font-weight="bold">',
            b.firstName, " ", b.lastName,
            '</text>',
            '<text x="60" y="634" fill="#E2001A" font-family="Helvetica,Arial,sans-serif" font-size="18" letter-spacing="1">',
            b.mainProject,
            '</text>',
            '<text x="60" y="666" fill="#8FA3BF" font-family="Helvetica,Arial,sans-serif" font-size="15">',
            b.startDate, " \xe2\x86\x92 ", b.completionDate,
            '</text>'
        );
    }

    /// @dev Wraps `details` onto up to 3 lines of <=42 chars. Mirrors
    /// wrapDetails() in shared/badge-template.ts.
    function _svgDetails(Badge storage b) private view returns (string memory) {
        bytes memory d = bytes(b.details);
        if (d.length == 0) return "";

        string memory out = "";
        uint256 lineStart;
        uint256 lastSpace;
        uint256 lines;

        for (uint256 i; i < d.length && lines < 3; ++i) {
            if (d[i] == 0x20) lastSpace = i;
            bool tooLong = i - lineStart >= 42;
            bool atEnd = i == d.length - 1;

            if (tooLong && lastSpace > lineStart) {
                out = string.concat(out, _detailLine(_slice(d, lineStart, lastSpace), lines));
                lines++;
                lineStart = lastSpace + 1;
            } else if (atEnd) {
                out = string.concat(out, _detailLine(_slice(d, lineStart, d.length), lines));
                lines++;
            }
        }
        return out;
    }

    function _detailLine(string memory text, uint256 index) private pure returns (string memory) {
        return string.concat(
            '<text x="60" y="', (700 + index * 22).toString(),
            '" fill="#8FA3BF" font-family="Helvetica,Arial,sans-serif" font-size="16">',
            text,
            '</text>'
        );
    }

    function _slice(bytes memory data, uint256 start, uint256 end) private pure returns (string memory) {
        bytes memory out = new bytes(end - start);
        for (uint256 i; i < out.length; ++i) out[i] = data[start + i];
        return string(out);
    }

    function _mime(uint8 id) private pure returns (string memory) {
        if (id == 0) return "image/webp";
        if (id == 1) return "image/png";
        return "image/jpeg";
    }

    function _requireMinted(uint256 tokenId) private view {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken(tokenId);
    }
}
