sap.ui.define([
    "jquery.sap.global",
    "sap/dm/dme/podfoundation/controller/PluginViewController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (jQuery, PluginViewController, JSONModel, MessageToast, MessageBox) {
    "use strict";

    var DATA_FIELD_LIST_PATH = "dataField/v1/dataFields";
    var DATA_FIELD_POST_PATH = "dataField/v1/dataFields";

    var TYPE_STATE_MAP = {
        "TEXT":      "None",
        "TEXT_AREA": "None",
        "NUMBER":    "Warning",
        "LIST":      "Success",
        "CHECKBOX":  "Information"
    };

    return PluginViewController.extend("sb.custom.plugins.datafieldtransport.controller.MainView", {

        onInit: function () {
            PluginViewController.prototype.onInit.apply(this, arguments);

            this._oModel = new JSONModel({
                fields:         [],
                fieldsFull:     [],
                selectedFields: [],
                selectedCount:  0,
                importFile:     null,
                importFileName: "",
                importPlant:    ""
            });
            this.getView().setModel(this._oModel, "dfModel");

            this._sPlant        = "";
            this._sPublicApiUri = "";
            this._sSearchQuery  = "";
            this._sTypeFilter   = "";
            this._oFileInput    = null;
        },

        onAfterRendering: function () {
            var oConfig = this.getConfiguration();
            this.getView().byId("backButton").setVisible(oConfig.backButtonVisible);
            this.getView().byId("closeButton").setVisible(oConfig.closeButtonVisible);
            this.getView().byId("headerTitle").setText(oConfig.title || this._getText("appTitle"));

            try {
                this._sPlant = this.getPodController().getUserPlant() || "";
            } catch (e) {
                jQuery.sap.log.warning("DataField Transport: getUserPlant failed - " + e.message);
            }

            try {
                this._sPublicApiUri = this.getPublicApiRestDataSourceUri() || "";
                if (this._sPublicApiUri && this._sPublicApiUri.slice(-1) !== "/") {
                    this._sPublicApiUri += "/";
                }
                jQuery.sap.log.info("DataField Transport: public API URI = " + this._sPublicApiUri);
            } catch (e) {
                jQuery.sap.log.warning("DataField Transport: getPublicApiRestDataSourceUri failed - " + e.message);
            }

            this._loadFields();
        },

        onBeforeRenderingPlugin: function () {},

        // --- Load ---

        _loadFields: function () {
            if (!this._sPublicApiUri) { return; }

            var oPanel = this.getView().byId("fieldListPanel");
            oPanel.setBusy(true);

            var sUrl = this._sPublicApiUri + DATA_FIELD_LIST_PATH
                + "?plant=" + encodeURIComponent(this._sPlant)
                + "&size=200&sort=createdDateTime,desc";

            this.ajaxGetRequest(sUrl, null,
                function (oData) {
                    oPanel.setBusy(false);
                    var aFields = (oData && oData.content) || [];
                    aFields.sort(function (a, b) { return a.fieldName.localeCompare(b.fieldName); });
                    this._oModel.setProperty("/fieldsFull", aFields);
                    this._oModel.setProperty("/fields",     aFields);
                    this._clearSelection();
                }.bind(this),
                function (oError, sMsg) {
                    oPanel.setBusy(false);
                    MessageToast.show(this._getText("msg.podLoadError"));
                }.bind(this)
            );
        },

        // --- Selection ---

        onSelectAll: function (oEvent) {
            var bSelected = oEvent.getParameter("selected");
            var oList = this.getView().byId("fieldList");
            var aItems = oList.getItems();
            aItems.forEach(function (oItem) { oItem.setSelected(bSelected); });
            this._updateSelection();
        },

        onFieldSelectionChange: function () {
            this._updateSelection();
        },

        _updateSelection: function () {
            var oList   = this.getView().byId("fieldList");
            var aItems  = oList.getSelectedItems();
            var aFields = this._oModel.getProperty("/fields") || [];

            var aSelected = aItems.map(function (oItem) {
                var iIdx = oList.indexOfItem(oItem);
                return aFields[iIdx];
            }).filter(Boolean);

            this._oModel.setProperty("/selectedFields", aSelected);
            this._oModel.setProperty("/selectedCount",  aSelected.length);

            // Sync select-all checkbox state
            var oSelectAll = this.getView().byId("selectAllBox");
            var aAll = oList.getItems();
            if (aSelected.length === 0) {
                oSelectAll.setSelected(false);
            } else if (aSelected.length === aAll.length) {
                oSelectAll.setSelected(true);
            } else {
                oSelectAll.setSelected(false);
            }
        },

        _clearSelection: function () {
            var oList = this.getView().byId("fieldList");
            if (oList) { oList.removeSelections(true); }
            this.getView().byId("selectAllBox").setSelected(false);
            this._oModel.setProperty("/selectedFields", []);
            this._oModel.setProperty("/selectedCount",  0);
        },

        // --- Export (multi) ---

        onExportPress: function () {
            var aSelected = this._oModel.getProperty("/selectedFields") || [];
            if (!aSelected.length) {
                MessageToast.show(this._getText("validation.noPodSelected"));
                return;
            }

            var aPayload = aSelected.map(function (oField) {
                return {
                    plant:            oField.plant,
                    fieldName:        oField.fieldName,
                    fieldLabel:       oField.fieldLabel,
                    description:      oField.description,
                    browsable:        oField.browsable,
                    type:             oField.type,
                    dataFieldOptions: oField.dataFieldOptions || []
                };
            });

            var sFilename = aSelected.length === 1
                ? aSelected[0].fieldName.replace(/[^a-zA-Z0-9_\-\.]/g, "_") + ".json"
                : "DataFields_" + aSelected.length + ".json";

            var sJson  = JSON.stringify(aPayload, null, 2);
            var oBlob  = new Blob([sJson], { type: "application/json" });
            var sUrl   = URL.createObjectURL(oBlob);

            var oAnchor = document.createElement("a");
            oAnchor.href = sUrl; oAnchor.download = sFilename; oAnchor.style.display = "none";
            document.body.appendChild(oAnchor); oAnchor.click();
            document.body.removeChild(oAnchor); URL.revokeObjectURL(sUrl);

            MessageToast.show("Exported " + aPayload.length + " field(s)");
        },

        // --- Import ---

        onImportPress: function () {
            var oFile  = this._oModel.getProperty("/importFile");
            var sPlant = (this._oModel.getProperty("/importPlant") || "").trim();
            if (!sPlant) { MessageToast.show(this._getText("validation.noImportPlant")); return; }
            if (!oFile)  { MessageToast.show(this._getText("validation.noFile")); return; }

            var that   = this;
            var oPanel = this.getView().byId("importPanel");
            oPanel.setBusy(true);

            var oReader = new FileReader();
            oReader.onload = function (oEvent) {
                var aPayload;
                try { aPayload = JSON.parse(oEvent.target.result); } catch (e) {
                    oPanel.setBusy(false); MessageBox.error("Invalid JSON: " + e.message); return;
                }
                if (!Array.isArray(aPayload)) { aPayload = [aPayload]; }

                aPayload = aPayload.map(function (oItem) {
                    return jQuery.extend({}, oItem, { plant: sPlant });
                });

                var sUrl = that._sPublicApiUri + DATA_FIELD_POST_PATH;

                that.ajaxPostRequest(sUrl, aPayload,
                    function () {
                        oPanel.setBusy(false);
                        MessageToast.show("Imported " + aPayload.length + " field(s) into plant " + sPlant);
                        that._oModel.setProperty("/importFile",     null);
                        that._oModel.setProperty("/importFileName", "");
                        if (sPlant === that._sPlant) { that._loadFields(); }
                    },
                    function (oError, sHttpMsg) {
                        oPanel.setBusy(false);
                        var sCode = ""; var sMessage = sHttpMsg || "";
                        try {
                            var oResp = typeof oError === "string" ? JSON.parse(oError) : oError;
                            if (oResp && oResp.error) {
                                sCode    = oResp.error.code    || "";
                                sMessage = oResp.error.message || sMessage;
                            }
                        } catch (e) { /* raw */ }
                        var sDisplay = sMessage;
                        if (sCode === "409" || sMessage.toLowerCase().indexOf("already exists") !== -1) {
                            sDisplay = "One or more fields already exist in plant " + sPlant + ".\nDelete them first then re-import.";
                        }
                        MessageBox.error(sDisplay, { title: "Import Failed (HTTP " + sCode + ")" });
                    }
                );
            };
            oReader.readAsText(oFile);
        },

        // --- File picker ---

        onBrowsePress: function () { this._getFileInput().click(); },

        _getFileInput: function () {
            if (!this._oFileInput) {
                this._oFileInput = document.createElement("input");
                this._oFileInput.type = "file"; this._oFileInput.accept = ".json,application/json";
                this._oFileInput.style.display = "none";
                document.body.appendChild(this._oFileInput);
                this._oFileInput.addEventListener("change", function (oEvent) {
                    var oFile = oEvent.target.files && oEvent.target.files[0];
                    if (oFile) {
                        this._oModel.setProperty("/importFile",     oFile);
                        this._oModel.setProperty("/importFileName", oFile.name);
                    }
                    this._oFileInput.value = "";
                }.bind(this));
            }
            return this._oFileInput;
        },

        // --- Events ---

        onRefreshPress: function () {
            this._sSearchQuery = ""; this._sTypeFilter = "";
            this.getView().byId("fieldSearchField").setValue("");
            this.getView().byId("fieldTypeFilter").setSelectedKey("");
            this._loadFields();
            MessageToast.show(this._getText("msg.refreshed"));
        },

        onFieldSearchLive: function (oEvent) {
            this._sSearchQuery = (oEvent.getParameter("newValue") || "").toLowerCase().trim();
            this._applyFilters();
        },

        onFieldSearch: function (oEvent) {
            this._sSearchQuery = (oEvent.getParameter("query") || "").toLowerCase().trim();
            this._applyFilters();
        },

        onTypeFilterChange: function (oEvent) {
            this._sTypeFilter = oEvent.getParameter("selectedItem").getKey();
            this._applyFilters();
        },

        _applyFilters: function () {
            var aFull = this._oModel.getProperty("/fieldsFull") || [];
            var aFiltered = aFull.filter(function (oField) {
                var bText = !this._sSearchQuery || (
                    oField.fieldName.toLowerCase().indexOf(this._sSearchQuery) !== -1 ||
                    (oField.fieldLabel || "").toLowerCase().indexOf(this._sSearchQuery) !== -1
                );
                var bType = !this._sTypeFilter || oField.type === this._sTypeFilter;
                return bText && bType;
            }.bind(this));
            this._oModel.setProperty("/fields", aFiltered);
            this._clearSelection();
        },

        onBackPress:  function () { PluginViewController.prototype.onBackPress.apply(this, arguments); },
        onClosePress: function () { PluginViewController.prototype.onClosePress.apply(this, arguments); },

        // --- Formatters ---

        formatTypeState: function (sType) { return TYPE_STATE_MAP[sType] || "None"; },
        formatBoolean:   function (bValue) { return bValue ? "Yes" : "No"; },

        // --- Utilities ---

        _getText: function (sKey, aArgs) {
            try { return this.getView().getModel("i18n").getResourceBundle().getText(sKey, aArgs); }
            catch (e) { return sKey; }
        },

        onExit: function () {
            if (this._oFileInput) { document.body.removeChild(this._oFileInput); this._oFileInput = null; }
            PluginViewController.prototype.onExit.apply(this, arguments);
        }
    });
});
