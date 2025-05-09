// Set PDF.js worker path
        pdfjsLib.GlobalWorkerOptions.workerSrc = 
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';

        // DOM elements
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');
        const fileList = document.getElementById('file-list');
        const fileCount = document.getElementById('file-count');
        const mergeBtn = document.getElementById('merge-btn');
        const themeToggle = document.getElementById('theme-toggle');
        const loadingIndicator = document.getElementById('loading');
        const filenameModal = document.getElementById('filename-modal');
        const outputFilename = document.getElementById('output-filename');
        const confirmSaveBtn = document.getElementById('confirm-save');
        const cancelSaveBtn = document.getElementById('cancel-save');

        // Store files
        let files = [];
        const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50MB
        const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
        const MAX_FILES = 20;
        let sortableInstance = null;

        // Initialize theme
        function initTheme() {
            const savedTheme = localStorage.getItem('theme') || 'light';
            document.documentElement.setAttribute('data-theme', savedTheme);
            themeToggle.checked = savedTheme === 'dark';
        }

        // Toggle theme
        function toggleTheme() {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            
            // Refresh ads on theme change
            refreshAds();
        }

        // Show loading indicator
        function showLoading(show) {
            loadingIndicator.style.display = show ? 'block' : 'none';
            mergeBtn.disabled = show;
            mergeBtn.innerHTML = show ? '<i class="fas fa-spinner fa-spin"></i> Processing...' : '<i class="fas fa-merge"></i> Merge PDF Files';
        }

        // Update file count display
        function updateFileCount() {
            fileCount.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
        }

        // File handling
        async function handleFiles(newFiles) {
            if (files.length + newFiles.length > MAX_FILES) {
                alert(`You can merge up to ${MAX_FILES} files at once. Please select fewer files.`);
                return;
            }

            const validFiles = Array.from(newFiles).filter(file => {
                const isPdf = file.type === 'application/pdf';
                const isImage = file.type.includes('image');
                
                if (!isPdf && !isImage) {
                    alert(`Skipped ${file.name} - only PDF and image files are supported`);
                    return false;
                }
                
                if (isPdf && file.size > MAX_PDF_SIZE) {
                    alert(`Skipped ${file.name} - PDF exceeds 50MB limit`);
                    return false;
                }
                
                if (isImage && file.size > MAX_IMAGE_SIZE) {
                    alert(`Skipped ${file.name} - image exceeds 10MB limit`);
                    return false;
                }
                
                return true;
            });

            if (validFiles.length === 0) return;

            files = [...files, ...validFiles];
            updateFileCount();
            await updateFileList();
            mergeBtn.disabled = files.length < 2;
            
            // Refresh ads after file selection
            refreshAds();
        }

        // Compress image file
        async function compressImageFile(file) {
            return new Promise((resolve) => {
                if (file.size <= MAX_IMAGE_SIZE / 2) {
                    resolve(file); // No need to compress small files
                    return;
                }

                const reader = new FileReader();
                reader.onload = function(event) {
                    const img = new Image();
                    img.onload = function() {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        
                        // Calculate new dimensions (reduce by 50% if very large)
                        let width = img.width;
                        let height = img.height;
                        if (width > 2000 || height > 2000) {
                            const ratio = Math.min(2000 / width, 2000 / height);
                            width = width * ratio;
                            height = height * ratio;
                        }
                        
                        canvas.width = width;
                        canvas.height = height;
                        ctx.drawImage(img, 0, 0, width, height);
                        
                        canvas.toBlob((blob) => {
                            const compressedFile = new File([blob], file.name, {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            });
                            resolve(compressedFile);
                        }, 'image/jpeg', 0.7); // 70% quality
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            });
        }

        // Update file list with previews
        async function updateFileList() {
            if (files.length === 0) {
                fileList.innerHTML = '<div class="empty-message">No files selected. Drag & drop files or click above to select.</div>';
                return;
            }

            // Clear existing list
            fileList.innerHTML = '';
            
            // Process files in parallel
            const fileItems = await Promise.all(files.map(async (file, index) => {
                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                fileItem.dataset.index = index;
                fileItem.draggable = true;
                
                fileItem.innerHTML = `
                    <button class="remove-btn" data-index="${index}">×</button>
                    <div class="file-preview" id="preview-${index}">
                        <i class="fas fa-${file.type.includes('pdf') ? 'file-pdf' : 'file-image'} pdf-icon"></i>
                    </div>
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                `;
                
                // Render preview
                try {
                    if (file.type.includes('pdf')) {
                        await renderPdfPreview(file, index);
                    } else {
                        await renderImagePreview(file, index);
                    }
                } catch (error) {
                    console.error(`Preview error for ${file.name}:`, error);
                    const previewDiv = fileItem.querySelector('.file-preview');
                    previewDiv.innerHTML = '<div class="preview-error"><i class="fas fa-exclamation-triangle"></i><p>Preview failed</p></div>';
                }
                
                return fileItem;
            }));
            
            fileItems.forEach(item => fileList.appendChild(item));
            
            // Initialize drag sorting
            initSortable();
            
            // Add remove event listeners
            document.querySelectorAll('.remove-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const index = parseInt(btn.dataset.index);
                    files.splice(index, 1);
                    updateFileCount();
                    updateFileList();
                    mergeBtn.disabled = files.length < 2;
                });
            });
        }

        // Initialize sortable drag-and-drop
        function initSortable() {
            if (sortableInstance) {
                sortableInstance.destroy();
            }
            
            sortableInstance = new Sortable(fileList, {
                animation: 150,
                handle: '.file-item',
                draggable: '.file-item',
                onEnd: function(evt) {
                    if (evt.oldIndex === evt.newIndex) return;
                    
                    // Update files array to match new order
                    const [removed] = files.splice(evt.oldIndex, 1);
                    files.splice(evt.newIndex, 0, removed);
                    updateFileList();
                }
            });
        }

        // Format file size
        function formatFileSize(bytes) {
            if (bytes < 1024) return bytes + ' bytes';
            else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
            else return (bytes / 1048576).toFixed(1) + ' MB';
        }

       // Render PDF preview with fallback to text content
async function renderPdfPreview(file, index) {
    const previewDiv = document.getElementById(`preview-${index}`);
    if (!previewDiv) return;
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(Math.min(1, pdf.numPages));
        
        // Try to extract text if rendering fails
        try {
            const viewport = page.getViewport({ scale: 1.0 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            
            // Adjust canvas size
            canvas.height = 180;
            canvas.width = (viewport.width / viewport.height) * 180;
            
            // Adjust viewport to match canvas
            const scaledViewport = page.getViewport({ scale: canvas.width / viewport.width });
            
            await page.render({
                canvasContext: context,
                viewport: scaledViewport
            }).promise;
            
            previewDiv.innerHTML = '';
            previewDiv.appendChild(canvas);
        } catch (renderError) {
            console.log('Rendering failed, falling back to text extraction');
            const textContent = await page.getTextContent();
            const text = textContent.items.map(item => item.str).join(' ');
            previewDiv.innerHTML = `
                <div class="preview-text">
                    <i class="fas fa-file-pdf"></i>
                    <p>${text.substring(0, 200)}${text.length > 200 ? '...' : ''}</p>
                </div>
            `;
        }
    } catch (error) {
        console.error(`Error rendering preview for ${file.name}:`, error);
        previewDiv.innerHTML = `
            <div class="preview-error">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Preview unavailable</p>
            </div>
        `;
    }
}

// Render image preview
async function renderImagePreview(file, index) {
    const previewDiv = document.getElementById(`preview-${index}`);
    if (!previewDiv) return;
    
    try {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        
        img.onload = () => {
            URL.revokeObjectURL(img.src); // Clean up
            previewDiv.innerHTML = '';
            previewDiv.appendChild(img);
        };
        
        img.onerror = () => {
            previewDiv.innerHTML = `
                <div class="preview-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Preview failed</p>
                </div>
            `;
        };
    } catch (error) {
        console.error(`Error rendering image preview for ${file.name}:`, error);
        previewDiv.innerHTML = `
            <div class="preview-error">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Preview failed</p>
            </div>
        `;
    }
}

        // Show filename modal
        function showFilenameModal() {
            // Set default filename based on current date and file types
            const hasPdf = files.some(f => f.type.includes('pdf'));
            const hasImage = files.some(f => f.type.includes('image'));
            
            let defaultName = 'merged-';
            if (hasPdf && !hasImage) defaultName += 'document';
            else if (!hasPdf && hasImage) defaultName += 'images';
            else defaultName += 'files';
            
            defaultName += `-${new Date().toISOString().slice(0,10)}.pdf`;
            outputFilename.value = defaultName;
            
            filenameModal.style.display = 'flex';
        }

        // Hide filename modal
        function hideFilenameModal() {
            filenameModal.style.display = 'none';
        }

        // Merge files into PDF
        async function mergeFiles(filename) {
            showLoading(true);
            
            try {
                const { PDFDocument, rgb } = PDFLib;
                const mergedPdf = await PDFDocument.create();
                
                // Process files in sequence to maintain order
                for (const file of files) {
                    try {
                        if (file.type.includes('pdf')) {
                            // Handle PDF files
                            const arrayBuffer = await file.arrayBuffer();
                            const pdfDoc = await PDFDocument.load(arrayBuffer);
                            const pages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
                            pages.forEach(page => mergedPdf.addPage(page));
                        } else {
                            // Handle image files
                            const arrayBuffer = await file.arrayBuffer();
                            
                            let image;
                            if (file.type.includes('jpeg') || file.type.includes('jpg')) {
                                image = await mergedPdf.embedJpg(arrayBuffer);
                            } else if (file.type.includes('png')) {
                                image = await mergedPdf.embedPng(arrayBuffer);
                            }
                            
                            if (image) {
                                const page = mergedPdf.addPage([image.width, image.height]);
                                page.drawImage(image, {
                                    x: 0,
                                    y: 0,
                                    width: image.width,
                                    height: image.height,
                                });
                            }
                        }
                    } catch (error) {
                        console.error(`Error processing ${file.name}:`, error);
                        alert(`Skipped ${file.name} - file may be corrupted or unsupported`);
                    }
                }
                
                const mergedPdfBytes = await mergedPdf.save();
                downloadMergedPdf(mergedPdfBytes, filename);
            } catch (error) {
                console.error('Merge error:', error);
                alert('An error occurred while merging. Please try again with different files.');
            } finally {
                showLoading(false);
            }
        }

        // Download merged PDF
        function downloadMergedPdf(pdfBytes, filename) {
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
            document.body.appendChild(a);
            a.click();
            
            // Clean up
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
        }

        // Initialize FAQ accordion
        function initFAQ() {
            document.querySelectorAll('.faq-question').forEach(question => {
                question.addEventListener('click', () => {
                    const answer = question.nextElementSibling;
                    const icon = question.querySelector('i');
                    
                    if (answer.style.display === 'block') {
                        answer.style.display = 'none';
                        icon.classList.remove('fa-chevron-up');
                        icon.classList.add('fa-chevron-down');
                    } else {
                        answer.style.display = 'block';
                        icon.classList.remove('fa-chevron-down');
                        icon.classList.add('fa-chevron-up');
                    }
                });
            });
        }

        // Load and refresh AdSense ads
        function loadAds() {
            // Top ad
            (adsbygoogle = window.adsbygoogle || []).push({
                google_ad_client: "ca-pub-XXXXXXXXXXXXXXXX",
                enable_page_level_ads: true
            });
            
            // Middle ad
            (adsbygoogle = window.adsbygoogle || []).push({
                google_ad_client: "ca-pub-XXXXXXXXXXXXXXXX",
                enable_page_level_ads: true
            });
            
            // Bottom ad
            (adsbygoogle = window.adsbygoogle || []).push({
                google_ad_client: "ca-pub-XXXXXXXXXXXXXXXX",
                enable_page_level_ads: true
            });
        }

        // Refresh AdSense ads
        function refreshAds() {
            // Destroy existing ads
            const adSlots = document.querySelectorAll('#ad-slot-top, #ad-slot-middle, #ad-slot-bottom');
            adSlots.forEach(slot => {
                slot.innerHTML = '';
            });
            
            // Reload ads after a short delay
            setTimeout(() => {
                loadAds();
            }, 300);
        }

        // Event listeners
        themeToggle.addEventListener('change', toggleTheme);
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('highlight');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('highlight'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('highlight');
            handleFiles(e.dataTransfer.files);
        });
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                handleFiles(fileInput.files);
                fileInput.value = ''; // Reset to allow selecting same files again
            }
        });
        mergeBtn.addEventListener('click', () => {
            if (files.length >= 2) {
                showFilenameModal();
            }
        });
        confirmSaveBtn.addEventListener('click', () => {
            hideFilenameModal();
            mergeFiles(outputFilename.value);
        });
        cancelSaveBtn.addEventListener('click', hideFilenameModal);

        // Initialize
        initTheme();
        initFAQ();
        updateFileCount();
        loadAds();
