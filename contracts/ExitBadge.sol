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
    ///
    /// The header below (gradients, sun, perspective grid floor, chrome frame)
    /// is fixed for every badge -- it does not depend on any stored field --
    /// so it is one literal rather than assembled at read time. Generated
    /// from the real buildSVG() output (scripted, not hand-transcribed) to
    /// rule out a copy error; see DECISIONS.md D33.
    function _buildSVG(Badge storage b) private view returns (string memory) {
        return string.concat(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"600\" height=\"800\" viewBox=\"0 0 600 800\"><defs><linearGradient id=\"sky\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#2b1055\"/><stop offset=\"0.55\" stop-color=\"#7c1f6e\"/><stop offset=\"1\" stop-color=\"#ff6b6b\"/></linearGradient><radialGradient id=\"sun\" cx=\"0.5\" cy=\"0.5\" r=\"0.5\"><stop offset=\"0\" stop-color=\"#ffd66b\"/><stop offset=\"1\" stop-color=\"#ff5f9e\"/></radialGradient><linearGradient id=\"chrome\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#ff8bd6\"/><stop offset=\"1\" stop-color=\"#7ee8ff\"/></linearGradient><clipPath id=\"floorClip\"><rect x=\"0\" y=\"712\" width=\"600\" height=\"88\"/></clipPath></defs><rect width=\"600\" height=\"800\" fill=\"url(#sky)\"/><circle cx=\"300\" cy=\"120\" r=\"155\" fill=\"url(#sun)\" opacity=\"0.92\"/><g clip-path=\"url(#floorClip)\"><rect x=\"0\" y=\"712\" width=\"600\" height=\"88\" fill=\"#0f3d52\"/><line x1=\"0\" y1=\"712\" x2=\"600\" y2=\"712\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.15\"/><line x1=\"0\" y1=\"718\" x2=\"600\" y2=\"718\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.18\"/><line x1=\"0\" y1=\"726\" x2=\"600\" y2=\"726\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.23\"/><line x1=\"0\" y1=\"738\" x2=\"600\" y2=\"738\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.30\"/><line x1=\"0\" y1=\"754\" x2=\"600\" y2=\"754\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.39\"/><line x1=\"0\" y1=\"776\" x2=\"600\" y2=\"776\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.51\"/><line x1=\"0\" y1=\"800\" x2=\"600\" y2=\"800\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.65\"/><line x1=\"-300\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"-240\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"-180\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"-120\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"-60\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"0\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"60\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"120\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"180\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"240\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"300\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"360\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"420\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"480\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"540\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"600\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"660\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"720\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"780\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"840\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/><line x1=\"900\" y1=\"800\" x2=\"300\" y2=\"706\" stroke=\"#20e3c2\" stroke-width=\"1\" opacity=\"0.35\"/></g><rect x=\"0\" y=\"0\" width=\"600\" height=\"6\" fill=\"url(#chrome)\"/><rect x=\"0\" y=\"6\" width=\"600\" height=\"46\" fill=\"#2b1055\" opacity=\"0.55\"/><text x=\"60\" y=\"36\" fill=\"#fdf4ff\" font-family=\"Arial Black,Helvetica,sans-serif\" font-weight=\"900\" font-size=\"15\" letter-spacing=\"6\">COMPLETION BADGE</text><rect x=\"94\" y=\"142\" width=\"412\" height=\"412\" fill=\"none\" stroke=\"url(#chrome)\" stroke-width=\"3\"/><rect x=\"98\" y=\"146\" width=\"404\" height=\"404\" fill=\"#1a0b33\"/><image x=\"100\" y=\"148\" width=\"400\" height=\"400\" preserveAspectRatio=\"xMidYMid slice\" href=\"",
            "data:", _mime(b.imageMime), ";base64,",
            Base64.encode(SSTORE2.read(b.imagePointer)),
            '"/>',
            '<text x="60" y="615" fill="url(#chrome)" font-family="Arial Black,Helvetica,sans-serif" font-weight="900" font-size="40" letter-spacing="1">',
            b.firstName, " ", b.lastName,
            "</text>",
            '<text x="60" y="646" fill="#ffd66b" font-family="Menlo,Consolas,monospace" font-size="17" letter-spacing="2">// ',
            b.mainProject,
            "</text>",
            '<text x="60" y="676" fill="#c9a8e0" font-family="Menlo,Consolas,monospace" font-size="14">',
            b.startDate, " :: ", b.completionDate,
            "</text>",
            _svgDetails(b),
            '<text x="60" y="784" fill="#20e3c2" font-family="Menlo,Consolas,monospace" font-size="11" letter-spacing="2">POLYGON // ERC-721 // FULLY ON-CHAIN</text>',
            "</svg>"
        );
    }

    /// @dev Wraps `details` onto up to 2 lines of <=42 chars, mirroring
    /// wrapDetails(text, 42, 2) in shared/badge-template.ts. Capped at 2
    /// (not 3, as in the earlier design) so the text never reaches the
    /// perspective grid floor starting at y=712.
    function _svgDetails(Badge storage b) private view returns (string memory) {
        bytes memory d = bytes(b.details);
        if (d.length == 0) return "";

        string memory out = "";
        uint256 lineStart;
        uint256 lastSpace;
        uint256 lines;

        for (uint256 i; i < d.length && lines < 2; ++i) {
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
            '<text x="60" y="', (690 + index * 20).toString(),
            '" fill="#c9a8e0" font-family="Menlo,Consolas,monospace" font-size="14">',
            text,
            "</text>"
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
