/* global $ */
/* global mhaStrings */
/* global Errors */
/* global Office */
/* global ParentFrame */
/* global GetHeaders */
/* global GetHeadersEWS */
/* exported GetHeadersRest*/

/*
 * GetHeadersRest.js
 *
 * This file has all the methods to get PR_TRANSPORT_MESSAGE_HEADERS
 * from the current message via REST.
 *
 * Requirement Sets and Permissions
 * getCallbackTokenAsync requires 1.5 and ReadItem
 * convertToRestId requires 1.3 and Restricted
 * restUrl requires 1.5 and ReadItem
 */

var GetHeadersRest = (function () {
    function send(headersLoadedCallback) {
        if (!GetHeaders.validItem()) {
            Errors.log(null, "No item selected (REST)", true);
            return;
        }

        ParentFrame.updateStatus(mhaStrings.mha_RequestSent);

        Office.context.mailbox.getCallbackTokenAsync({ isRest: true }, function (result) {
            try {
                if (result.status === "succeeded") {
                    var accessToken = result.value;
                    getHeaders(accessToken, headersLoadedCallback);
                } else {
                    Errors.log(null, 'Unable to obtain callback token.\nFallback to EWS.\n' + JSON.stringify(result, null, 2), true);
                    GetHeadersEWS.send(headersLoadedCallback);
                }
            }
            catch (e) {
                ParentFrame.showError(e, "Failed in getCallbackTokenAsync");
            }
        });
    }

    function getItemRestId() {
        // Currently the only Outlook Mobile version that supports add-ins
        // is Outlook for iOS.
        if (Office.context.mailbox.diagnostics.hostName === "OutlookIOS") {
            // itemId is already REST-formatted
            return Office.context.mailbox.item.itemId;
        } else {
            // Convert to an item ID for API v2.0
            return Office.context.mailbox.convertToRestId(
                Office.context.mailbox.item.itemId,
                Office.MailboxEnums.RestVersion.v2_0
            );
        }
    }

    function getBaseUrl(url) {
        var parts = url.split("/");

        return parts[0] + "//" + parts[2];
    }

    function getRestUrl(accessToken) {
        // Shim function to workaround
        // mailbox.restUrl == null case
        if (Office.context.mailbox.restUrl) {
            return getBaseUrl(Office.context.mailbox.restUrl);
        }

        // parse the token
        var jwt = window.jwt_decode(accessToken);

        // 'aud' parameter from token can be in a couple of
        // different formats.

        // Format 1: It's just the URL
        if (jwt.aud.match(/https:\/\/([^@]*)/)) {
            return jwt.aud;
        }

        // Format 2: GUID/hostname@GUID
        var match = jwt.aud.match(/\/([^@]*)@/);
        if (match && match[1]) {
            return "https://" + match[1];
        }

        // Couldn't find what we expected, default to
        // outlook.office.com
        return "https://outlook.office.com";
    }

    function getHeaders(accessToken, headersLoadedCallback) {
        if (!accessToken) {
            Errors.log(null, "No access token?");
        }

        if (!Office.context.mailbox.item.itemId) {
            Errors.log(null, "No itemId?");
        }

        // Get the item's REST ID
        var itemId = getItemRestId();

        var getMessageUrl = getRestUrl(accessToken) +
            "/api/v2.0/me/messages/" +
            itemId +
            // PR_TRANSPORT_MESSAGE_HEADERS
            "?$select=SingleValueExtendedProperties&$expand=SingleValueExtendedProperties($filter=PropertyId eq 'String 0x007D')";

        $.ajax({
            url: getMessageUrl,
            dataType: "json",
            headers: {
                "Authorization": "Bearer " + accessToken,
                "Accept": "application/json; odata.metadata=none"
            }
        }).done(function (item) {
            try {
                if (item.SingleValueExtendedProperties !== undefined) {
                    headersLoadedCallback(item.SingleValueExtendedProperties[0].Value, "REST");
                } else {
                    headersLoadedCallback(null, "REST");
                    ParentFrame.showError(null, mhaStrings.mha_headersMissing, true);
                }
            }
            catch (e) {
                ParentFrame.showError(e, "Failed parsing headers");
            }
        }).fail(function (jqXHR, textStatus, errorThrown) {
            try {
                if (textStatus === "error" && jqXHR.status === 0) {
                    // TODO: Log this, but don't error for the user
                    GetHeadersEWS.send(headersLoadedCallback);
                } else if (textStatus === "error" && jqXHR.status === 404) {
                    ParentFrame.showError(null, mhaStrings.mha_messageMissing, true);
                } else {
                    ParentFrame.showError(null, "textStatus: " + textStatus + '\nerrorThrown: ' + errorThrown + "\nState: " + jqXHR.state() + "\njqXHR: " + JSON.stringify(jqXHR, null, 2));
                }
            }
            catch (e) {
                ParentFrame.showError(e, "Failed handling REST failure case");
            }
        });
    }

    return {
        send: send
    }
})();
