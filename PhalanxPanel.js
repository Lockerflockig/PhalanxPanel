// ==UserScript==
// @name         Enhanced Galaxy Info Panel
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Zeigt ein zusätzliches Info-Panel rechts neben der Systemtabelle in pr0game an, plus Phalanx-Überwachungsanzeige und Allianz-Warnungen
// @author       GalaxyInfo
// @match        https://pr0game.com/uni5/game.php?page=galaxy*
// @grant        GM_xmlhttpRequest
// @connect      pr0gamedb.neffez.dev
// @require      https://unpkg.com/pocketbase@0.19.0/dist/pocketbase.umd.js
// ==/UserScript==

(function() {
    'use strict';

    // PocketBase-Instanz erstellen
    const BASE_URL = '';
    const API_BASE_URL = `${BASE_URL}/api`;
    const MAX_SYSTEMS = 400;

    const pb = new PocketBase(BASE_URL);

    const PB_EMAIL = "";
    const PB_PASSWORD = "";

    let isAuth = false;
    let currentSys = getCurrentSystem();
    let phalanxList = {};
    let allianceMap = new Map(); // Initialize as a Map here

    // Konfiguration für Allianzfarben und Warnungs-Präfixe
    const allianceConfig = {
        'SPACE INVADERS': {
            color: '#FF4500',
            warningPrefix: '',
            isHostile: true
        },
        'FormidableFernichter': {
            color: '#e7793d',
            warningPrefix: '',
            isHostile: false
        },
        'Sinnlos im Weltraum': {
            color: '#9932CC',
            warningPrefix: '',
            isHostile: false
        },
        'Hailiger Graal': {
            color: '#32CD32',
            warningPrefix: '',
            isHostile: false
        },
        'Space Schmuser': {
            color: '#25e184',
            warningPrefix: '',
            isHostile: false
        },
        // Weitere Allianzen hier hinzufügen
        'default': {
            color: '#FFFFFF',
            warningPrefix: '',
            isHostile: false
        }
    };

    // Initialisierung
    async function init() {
        // Panel erstellen
        createInfoPanel();

        try {
            // Status-Anzeige im Panel
            const entriesContainer = document.getElementById('galaxyInfoEntries');
            if (entriesContainer) {
                entriesContainer.innerHTML = '<div style="text-align: center; padding: 10px;">Lade Daten...</div>';
            }

            // Authentifizieren
            const authSuccess = await authenticate();
            if (!authSuccess) {
                throw new Error('Authentifizierung fehlgeschlagen');
            }

            // Allianzdaten laden
            allianceMap = await getAlliances();
            console.log('Alliance map loaded:', allianceMap);

            // Monddaten laden
            const moonData = await getFilteredMoonData();
            phalanxList = moonData;
            console.log('Gefundene Monde mit Phalanx:', moonData);

            // Panel mit den gefundenen Daten aktualisieren
            updatePhalanxDisplay();
        } catch (error) {
            console.error('Fehler bei der Datenabfrage:', error);
            handleInitError(error);
        }

        // Event-Listener für Seitenwechsel
        const galaxyForm = document.querySelector('form[name="galaxy_form"]');
        if (galaxyForm) {
            galaxyForm.addEventListener('submit', function() {
                // Kurze Verzögerung, um sicherzustellen, dass die Seite geladen ist
                setTimeout(updatePhalanxDisplay, 500);
            });
        }

        // Event-Listener für Klicks auf die Navigationsbuttons
        document.addEventListener('click', function(e) {
            if (e.target && (e.target.id === 'systemRight' || e.target.id === 'systemLeft' ||
                e.target.id === 'galaxyRight' || e.target.id === 'galaxyLeft')) {
                // Kurze Verzögerung, um sicherzustellen, dass die Seite geladen ist
                setTimeout(updatePhalanxDisplay, 500);
            }
        });
    }

    // Handler für Initialisierungsfehler
    function handleInitError(error) {
        const entriesContainer = document.getElementById('galaxyInfoEntries');
        if (entriesContainer) {
            entriesContainer.innerHTML = `
                <div style="text-align: center; padding: 10px; color: #ff6666;">
                    Fehler beim Laden der Daten.<br>
                    <small>${error.message || 'Unbekannter Fehler'}</small><br>
                    <button id="retryButton" style="margin-top: 10px; padding: 5px 10px; background: #444; border: none; color: white; cursor: pointer;">
                        Erneut versuchen
                    </button>
                </div>
            `;

            // Retry-Button Funktionalität
            const retryButton = document.getElementById('retryButton');
            if (retryButton) {
                retryButton.addEventListener('click', () => {
                    entriesContainer.innerHTML = '<div style="text-align: center; padding: 10px;">Lade Daten erneut...</div>';
                    init().catch(retryError => {
                        console.error('Erneuter Fehler:', retryError);
                        entriesContainer.innerHTML = `
                            <div style="text-align: center; padding: 10px; color: #ff6666;">
                                Daten konnten nicht geladen werden.<br>
                                <small>${retryError.message || 'Unbekannter Fehler'}</small>
                            </div>
                        `;
                    });
                });
            }
        }
    }

    async function getAlliances() {
        try {
            console.log('Lade Allianzen...');
            const records = await pb.collection('alliances').getFullList();
            console.log('Allianz-Datensätze geladen:', records.length);
            console.log(records);

            // Erstelle und gib eine Map zurück
            const allianceMapping = new Map();
            records.forEach(alliance => {
                allianceMapping.set(alliance.alli_id, alliance.alli_name);
            });

            return allianceMapping;
        } catch (error) {
            console.error('Fehler beim Laden der Allianzen:', error);
            // Gib eine leere Map zurück, wenn ein Fehler auftritt
            return new Map();
        }
    }

    async function authenticate() {
        try {
            console.log('Versuche Authentifizierung...');
            const authData = await pb.collection('users')
                .authWithPassword(
                    PB_EMAIL,
                    PB_PASSWORD
                );
            console.log("Authentifizierung erfolgreich!");
            isAuth = true;
            return true;
        } catch (error) {
            console.error("Authentifizierungsfehler:", error);
            console.error("Details:", error.status, error.data, error.message || '');

            // Prüfen, ob der PocketBase-Server überhaupt erreichbar ist
            try {
                console.log("Prüfe Server-Erreichbarkeit...");
                const response = await fetch(`${BASE_URL}/api/health`);
                console.log("Server-Status:", response.status, response.ok);
                if (!response.ok) {
                    console.error("Server nicht erreichbar oder gibt Fehler zurück");
                }
            } catch (fetchError) {
                console.error("Server scheint nicht erreichbar zu sein:", fetchError);
            }

            isAuth = false;
            return false;
        }
    }

    async function getFilteredMoonData() {
        try {
            // Authenticate first if not already authenticated
            if (!isAuth) {
                const authSuccess = await authenticate();
                if (!authSuccess) {
                    console.error('Authentifizierung fehlgeschlagen. Kann keine Daten abrufen.');
                    return [];
                }
            }

            console.log('Versuche Monddaten abzurufen...');

            // Verwende ein einfacheres Filter und erweitertes Error-Handling
            try {
                const moons = await pb.collection('galaxy_state').getFullList({
                    filter: 'has_moon = true',
                    expand: 'moon_buildings,moon_buildings.player'
                });

                console.log(`${moons.length} Monde gefunden.`);

                const filteredList = moons.reduce((result, moon) => {
                    try {
                        // Prüfen, ob moon_buildings expandiert wurde
                        if (!moon.expand || !moon.expand.moon_buildings) {
                            return result;
                        }

                        const spyReport = moon.expand.moon_buildings;
                        const player = spyReport.expand?.player;
                        console.log(allianceMap);

                        if (!player) {
                            console.warn('Keine Spielerinformationen für Mond:', moon);
                            return result;
                        }

                        const playerId = player.id;
                        // Sicherheitsprüfung für allianceMap
                        let alliance = "Keine Allianz";
                        if (player.alli_id && allianceMap && typeof allianceMap.get === 'function') {
                            alliance = allianceMap.get(player.alli_id) || "Keine Allianz";
                        }

                        // Prüfen verschiedene mögliche Orte für die Phalanx-Daten
                        const catData = spyReport.cat0 || spyReport.cate || spyReport.categories || {};
                        const lvl42 = parseInt(catData["42"] || 0);

                        if (lvl42 > 1) {  // Nur wenn Level > 1
                            result.push({
                                coordinate: {
                                    galaxy: moon.pos_galaxy || moon.galaxy,
                                    system: moon.pos_system || moon.system,
                                    position: moon.pos_planet || moon.position
                                },
                                name: player?.name || player?.player_name || "Unbekannt",
                                alliance: alliance,
                                lvl: lvl42
                            });
                        }
                    } catch (itemError) {
                        console.warn('Fehler bei der Verarbeitung eines Mondes:', itemError);
                    }
                    return result;
                }, []);

                console.log(`${filteredList.length} Monde mit Phalanx > Level 1 gefunden.`);
                return filteredList;

            } catch (apiError) {
                console.error('API-Fehler:', apiError);

                // Versuche es erneut mit Authentifizierung
                console.log('Versuche erneute Authentifizierung...');
                await authenticate();

                // Vereinfachte Anfrage als Fallback
                console.log('Versuche vereinfachte Anfrage...');
                const simpleMoons = await pb.collection('galaxy_state').getFullList();
                console.log(`Erhaltene Datensätze: ${simpleMoons.length}`);

                // Dummy-Daten zurückgeben, falls alles fehlschlägt
                return [{
                    coordinate: { galaxy: 1, system: 1, position: 1 },
                    name: "Test",
                    alliance: "FSociety",
                    lvl: 4
                }];
            }

        } catch (error) {
            console.error('Schwerwiegender Fehler beim Abrufen der Monddaten:', error);
            console.error('Error details:', error.stack || error.message || 'Keine Details verfügbar');

            // Dummy-Daten zurückgeben, damit das Skript nicht komplett fehlschlägt
            return [{
                coordinate: { galaxy: 1, system: 1, position: 1 },
                name: "Test-Fallback",
                alliance: "Hydra",
                lvl: 4
            }];
        }
    }

    function getCurrentSystem() {
        const galaxyInput = document.querySelector('input[name="galaxy"]');
        const systemInput = document.querySelector('input[name="system"]');

        if (!galaxyInput || !systemInput) return { galaxy: 1, system: 1 };

        return {
            galaxy: parseInt(galaxyInput.value) || 1,
            system: parseInt(systemInput.value) || 1
        };
    }

    // Berechnet die Phalanx-Reichweite
    function calculatePhalanxRange(phalanxLvl, moonSystem) {
        // Formel: range = phalanxLvl * phalanxLvl - 1
        const range = phalanxLvl * phalanxLvl - 1;

        // Berechne untere Grenze
        let lowerEnd = moonSystem - range;
        if (lowerEnd < 1) {
            lowerEnd = MAX_SYSTEMS + lowerEnd;
        }

        // Berechne obere Grenze
        let upperEnd = moonSystem + range;
        if (upperEnd > MAX_SYSTEMS) {
            upperEnd = upperEnd - MAX_SYSTEMS;
        }

        return { lowerEnd, upperEnd, range };
    }

    // Prüft, ob ein System innerhalb einer Phalanx-Reichweite liegt
    function isSystemInRange(systemToCheck, moonSystem, phalanxRange) {
        // Direkte Prüfung: moonSystem - range <= systemToCheck <= moonSystem + range
        if (phalanxRange.lowerEnd <= phalanxRange.upperEnd) {
            // Keine Umwicklung
            return systemToCheck >= phalanxRange.lowerEnd && systemToCheck <= phalanxRange.upperEnd;
        } else {
            // Mit Umwicklung (überquert MAX_SYSTEMS)
            return systemToCheck >= phalanxRange.lowerEnd || systemToCheck <= phalanxRange.upperEnd;
        }
    }

    // Panel erstellen
    function createInfoPanel() {
        // Hauptcontainer für das Panel
        const panel = document.createElement('div');
        panel.id = 'galaxyInfoPanel';
        panel.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            width: 280px;
            max-height: 70vh;
            background-color: rgba(30, 30, 30, 0.9);
            border-radius: 8px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
            color: #FFFFFF;
            font-family: Arial, sans-serif;
            z-index: 9999;
            display: flex;
            flex-direction: column;
        `;

        // Panel-Header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 12px;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        `;
        header.textContent = 'Phalanx Ansicht';
        panel.appendChild(header);

        // Container für die Einträge mit Scrollfunktion
        const entriesContainer = document.createElement('div');
        entriesContainer.id = 'galaxyInfoEntries';
        entriesContainer.style.cssText = `
            padding: 10px;
            overflow-y: auto;
            max-height: calc(70vh - 100px);
        `;
        panel.appendChild(entriesContainer);

        // Panel zum Body hinzufügen
        document.body.appendChild(panel);

        return panel;
    }

    // Eintrag hinzufügen
    function addEntry(alliance, player, phalanxLevel, coordinates, inRange = false, rangeInfo = null) {
        const entriesContainer = document.getElementById('galaxyInfoEntries');

        // Neuen Eintrag erstellen
        const entry = document.createElement('div');

        // Allianz-Konfiguration abrufen
        const allianceConf = allianceConfig[alliance] || allianceConfig.default;
        const color = allianceConf.color;
        const prefix = allianceConf.warningPrefix;
        const isHostile = allianceConf.isHostile;

        // Hintergrundfarbe je nach Feindlichkeit und In-Range-Status anpassen
        let bgColor = isHostile ? 'rgba(80, 30, 30, 0.6)' : 'rgba(50, 50, 50, 0.5)';

        // Highlight für Monde, die den aktuellen Spieler scannen können
        if (inRange) {
            bgColor = isHostile ? 'rgba(150, 30, 30, 0.8)' : 'rgba(69,65,65,0.8)';
        }

        entry.style.cssText = `
            margin-bottom: 8px;
            padding: 8px 10px;
            background-color: ${bgColor};
            border-left: 3px solid ${color};
            border-radius: 4px;
            font-size: 13px;
        `;

        // Text für den Eintrag formatieren mit Präfix wenn vorhanden
        const prefixText = prefix ? `<strong style="color: #FF6666">${prefix} </strong>` : '';

        // Range-Information hinzufügen, wenn vorhanden
        let rangeText = '';
        if (rangeInfo) {
            rangeText = `<div style="margin-top: 3px; ${inRange ? 'color: #FF9900; font-weight: bold;' : ''}">
                Reichweite: von ${rangeInfo.lowerEnd} bis ${rangeInfo.upperEnd} Systeme
                ${inRange ? ' - <span style="color: #FF3333">Du bist in Reichweite!</span>' : ''}
            </div>`;
        }

        entry.innerHTML = `
            ${prefixText}<strong>Allianz: ${alliance}</strong><br>
            Spieler: ${player}<br>
            Phalanx Lvl ${phalanxLevel}<br>
            Koordinaten: ${coordinates}
            ${rangeText}
        `;

        entriesContainer.appendChild(entry);
    }

    // Alle Einträge löschen
    function clearEntries() {
        const entriesContainer = document.getElementById('galaxyInfoEntries');
        if (entriesContainer) {
            entriesContainer.innerHTML = '';
        }
    }

    // Aktualisiert die Anzeige basierend auf dem aktuellen System
    function updatePhalanxDisplay() {
        currentSys = getCurrentSystem();
        console.log("Aktuelles System:", currentSys);

        clearEntries();
        const entriesContainer = document.getElementById('galaxyInfoEntries');

        if (!phalanxList || phalanxList.length === 0) {
            entriesContainer.innerHTML = '<div style="text-align: center; padding: 10px;">Keine Phalanx-Monde gefunden.</div>';
            return;
        }

        // Prüfe für jeden Mond, ob sein Phalanx-Scanner in Reichweite ist
        const inRangeMoons = [];
        const outOfRangeMoons = [];

        phalanxList.forEach(moon => {
            // Nur Monde in der gleichen Galaxie betrachten
            if (moon.coordinate.galaxy === currentSys.galaxy) {
                const phalanxRange = calculatePhalanxRange(moon.lvl, moon.coordinate.system);
                const inRange = isSystemInRange(currentSys.system, moon.coordinate.system, phalanxRange);

                // In die entsprechende Liste einfügen
                if (inRange) {
                    inRangeMoons.push({...moon, phalanxRange});
                } else {
                    outOfRangeMoons.push({...moon, phalanxRange});
                }
            } else {
                outOfRangeMoons.push({...moon, phalanxRange: null});
            }
        });

        // Header erstellen
        const header = document.createElement('div');
        header.style.cssText = `
            text-align: center;
            padding: 5px;
            margin-bottom: 10px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
            font-size: 12px;
        `;

        // Zeige an, ob der Spieler in Reichweite von Phalanx-Scannern ist
        if (inRangeMoons.length > 0) {
            header.innerHTML = `<strong style="color: #f62a2a">WARNUNG: ${inRangeMoons.length} Phalanx-Scanner in Reichweite!</strong>`;
        } else {
            header.innerHTML = `<strong style="color: #66FF66">Kein Phalanx-Scanner in Reichweite</strong><br>
                                <small>Insgesamt ${phalanxList.length} Phalanx-Monde gefunden</small>`;
        }
        entriesContainer.appendChild(header);

        // Sortiere nach Feindlichkeit und In-Range Status
        const sortMoons = (a, b) => {
            // Priorisiere In-Range-Status
            if ((a.phalanxRange && b.phalanxRange === null) ||
                (inRangeMoons.includes(a) && !inRangeMoons.includes(b))) return -1;
            if ((a.phalanxRange === null && b.phalanxRange) ||
                (!inRangeMoons.includes(a) && inRangeMoons.includes(b))) return 1;

            // Dann nach feindlichen Allianzen sortieren
            const aConfig = allianceConfig[a.alliance] || allianceConfig.default;
            const bConfig = allianceConfig[b.alliance] || allianceConfig.default;
            if (aConfig.isHostile && !bConfig.isHostile) return -1;
            if (!aConfig.isHostile && bConfig.isHostile) return 1;

            // Dann nach Koordinaten sortieren
            if (a.coordinate.galaxy !== b.coordinate.galaxy) {
                return a.coordinate.galaxy - b.coordinate.galaxy;
            }
            if (a.coordinate.system !== b.coordinate.system) {
                return a.coordinate.system - b.coordinate.system;
            }
            return a.coordinate.position - b.coordinate.position;
        };

        // Zuerst Monde in Reichweite anzeigen
        if (inRangeMoons.length > 0) {
            const inRangeHeader = document.createElement('div');
            inRangeHeader.style.cssText = `
                font-weight: bold;
                margin: 10px 0 5px 0;
                padding-bottom: 5px;
                border-bottom: 1px dotted rgba(255, 255, 255, 0.3);
                color: #FF9900;
            `;
            inRangeHeader.textContent = 'In Reichweite:';
            entriesContainer.appendChild(inRangeHeader);

            // Sortiere und zeige Monde in Reichweite
            inRangeMoons.sort(sortMoons).forEach(moon => {
                const coords = `[${moon.coordinate.galaxy}:${moon.coordinate.system}:${moon.coordinate.position}]`;
                addEntry(
                    moon.alliance || "Keine Allianz",
                    moon.name,
                    moon.lvl,
                    coords,
                    true,
                    moon.phalanxRange
                );
            });
        }

        // Dann Monde außerhalb der Reichweite anzeigen, wenn in-Range Monde vorhanden sind
        if (outOfRangeMoons.length > 0 && inRangeMoons.length > 0) {
            const outOfRangeHeader = document.createElement('div');
            outOfRangeHeader.style.cssText = `
                font-weight: bold;
                margin: 10px 0 5px 0;
                padding-bottom: 5px;
                border-bottom: 1px dotted rgba(255, 255, 255, 0.3);
                color: #999999;
            `;
            outOfRangeHeader.textContent = 'Außerhalb Reichweite:';
            entriesContainer.appendChild(outOfRangeHeader);

            // Zeige nur die ersten 10 oder so, um die Liste übersichtlich zu halten
            const maxToShow = 10;
            outOfRangeMoons.sort(sortMoons).slice(0, maxToShow).forEach(moon => {
                const coords = `[${moon.coordinate.galaxy}:${moon.coordinate.system}:${moon.coordinate.position}]`;
                addEntry(
                    moon.alliance || "Keine Allianz",
                    moon.name,
                    moon.lvl,
                    coords,
                    false,
                    moon.phalanxRange
                );
            });

            // Wenn es mehr gibt, zeige einen Hinweis
            if (outOfRangeMoons.length > maxToShow) {
                const moreInfo = document.createElement('div');
                moreInfo.style.cssText = `
                    text-align: center;
                    padding: 5px;
                    margin-top: 5px;
                    font-size: 11px;
                    color: #888888;
                `;
                moreInfo.textContent = `... und ${outOfRangeMoons.length - maxToShow} weitere außerhalb Reichweite`;
                entriesContainer.appendChild(moreInfo);
            }
        } else if (outOfRangeMoons.length > 0 && inRangeMoons.length === 0) {
            // Wenn keine Monde in Reichweite sind, zeige alle Monde ohne zusätzliche Header
            outOfRangeMoons.sort(sortMoons).forEach(moon => {
                const coords = `[${moon.coordinate.galaxy}:${moon.coordinate.system}:${moon.coordinate.position}]`;
                addEntry(
                    moon.alliance || "Keine Allianz",
                    moon.name,
                    moon.lvl,
                    coords,
                    false,
                    moon.phalanxRange
                );
            });
        }
    }

    // Skript starten, wenn die Seite geladen ist
    window.addEventListener('load', init);

})();