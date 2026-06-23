// ==UserScript==
// @name         Weda - Impression CDA en PDF
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Bouton d'impression pour biologies CDA (Gère les iframes imbriquées). From FLorent Online Santé.
// @match        https://secure.weda.fr/*
// @allFrames    true
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 🧹 EXTERMINATEUR DE PARASITES
    const parasiteBtn = document.getElementById('btn-print-weda');
    if (parasiteBtn) parasiteBtn.remove();

    // Vérification en continu
    setInterval(() => {
        // On cherche les documents non traités
        const iframes = document.querySelectorAll('iframe[src^="data:text/html;base64"]:not([data-weda-pdf-traite])');

        iframes.forEach(iframe => {
            // On marque le document
            iframe.setAttribute('data-weda-pdf-traite', 'true');

            // Création de la barre au-dessus du document
            const panel = document.createElement('div');
            panel.style.display = 'flex';
            panel.style.marginBottom = '10px';
            panel.style.justifyContent = 'flex-end'; // Aligné à droite
            panel.style.width = iframe.style.width || '100%';

            // --- BOUTON IMPRIMER ---
            const btnPrint = document.createElement('button');
            btnPrint.innerHTML = '🖨️ Imprimer';

            // Design du bouton
            btnPrint.style.padding = '8px 15px';
            btnPrint.style.backgroundColor = '#d32f2f';
            btnPrint.style.color = 'white';
            btnPrint.style.border = 'none';
            btnPrint.style.borderRadius = '4px';
            btnPrint.style.cursor = 'pointer';
            btnPrint.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
            btnPrint.style.fontWeight = 'bold';
            btnPrint.style.fontSize = '13px';
            btnPrint.style.transition = 'background-color 0.2s';

            btnPrint.onmouseover = () => btnPrint.style.backgroundColor = '#b71c1c';
            btnPrint.onmouseout = () => btnPrint.style.backgroundColor = '#d32f2f';

            // Action d'impression
            btnPrint.onclick = async function() {
                try {
                    const response = await fetch(iframe.src);
                    const blob = await response.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    const printWindow = window.open(blobUrl, '_blank');

                    if (printWindow) {
                        printWindow.onload = () => {
                            printWindow.onafterprint = () => printWindow.close();
                            printWindow.print();
                        };
                    } else {
                        alert("Veuillez autoriser l'ouverture des pop-ups pour Weda.");
                    }
                } catch (error) {
                    console.error("Erreur d'impression :", error);
                }
            };

            // On ajoute le bouton
            panel.appendChild(btnPrint);
            iframe.parentNode.insertBefore(panel, iframe);
        });

    }, 1000);

})();