/**
 * Responsive Internship Board - Application Logic
 * Vanilla JavaScript (ES6+)
 * 
 * Features:
 * - Dynamic data fetching from JSON dataset
 * - Automatic dynamic domain filter generation
 * - Simultaneous real-time search & domain filtering
 * - Robust UI states: Loading, Default, Empty, and Error states
 * - Accessible live status updates for screen readers
 */

(function () {
  'use strict';

  // State Management
  const state = {
    internships: [],
    isLoading: true,
    error: null,
    searchQuery: '',
    selectedDomain: 'all',
  };

  // DOM Elements
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('clear-search-btn');
  const domainFilter = document.getElementById('domain-filter');
  const resetFiltersBtn = document.getElementById('reset-filters-btn');
  const resultsCount = document.getElementById('results-count');
  const activeFilterTags = document.getElementById('active-filter-tags');
  const internshipGrid = document.getElementById('internship-grid');
  const loadingState = document.getElementById('loading-state');
  const errorState = document.getElementById('error-state');
  const errorMessage = document.getElementById('error-message');
  const retryBtn = document.getElementById('retry-btn');
  const emptyState = document.getElementById('empty-state');
  const emptyResetBtn = document.getElementById('empty-reset-btn');

  /**
   * Escape HTML utility to prevent XSS injection
   * @param {string} str 
   * @returns {string}
   */
  function escapeHTML(str) {
    if (typeof str !== 'string') return String(str ?? '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Fetch internship records from JSON dataset
   */
  async function loadInternships() {
    state.isLoading = true;
    state.error = null;
    updateUIStates();

    try {
      const response = await fetch('data/internships.json');
      
      if (!response.ok) {
        throw new Error(`Failed to load dataset: Server responded with status ${response.status}`);
      }

      const data = await response.json();

      if (!data || !Array.isArray(data.internships)) {
        throw new Error('Invalid dataset format: expected "internships" array.');
      }

      state.internships = data.internships;
      state.isLoading = false;

      // Populate domain filter options dynamically
      populateDomainFilter(state.internships);

      // Render cards according to current filters
      render();
    } catch (err) {
      console.error('Error fetching internships:', err);
      state.isLoading = false;
      state.error = err.message || 'An unexpected error occurred while loading internship data.';
      updateUIStates();
    }
  }

  /**
   * Populate domain dropdown dynamically from dataset records
   * @param {Array} list 
   */
  function populateDomainFilter(list) {
    // Preserve default "All Domains" option
    domainFilter.innerHTML = '<option value="all">All Domains</option>';

    // Extract unique domains and sort alphabetically
    const domains = Array.from(
      new Set(list.map(item => item.domain).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    domains.forEach(domain => {
      const option = document.createElement('option');
      option.value = domain;
      option.textContent = domain;
      domainFilter.appendChild(option);
    });
  }

  /**
   * Filter internships based on current searchQuery and selectedDomain
   * @returns {Array} filtered list
   */
  function getFilteredInternships() {
    const query = state.searchQuery.trim().toLowerCase();
    const domain = state.selectedDomain;

    return state.internships.filter(internship => {
      // 1. Domain Filter matching
      const matchesDomain = (domain === 'all' || internship.domain === domain);

      // 2. Search Query matching (title, domain, location, work mode, skills)
      let matchesSearch = true;
      if (query.length > 0) {
        const titleMatch = (internship.title || '').toLowerCase().includes(query);
        const domainMatch = (internship.domain || '').toLowerCase().includes(query);
        const locationMatch = (internship.location || '').toLowerCase().includes(query);
        const modeMatch = (internship.mode || '').toLowerCase().includes(query);
        const companyMatch = (internship.company || '').toLowerCase().includes(query);
        
        // Skills search: check if any skill includes the query string
        const skillsMatch = Array.isArray(internship.skills) && internship.skills.some(skill =>
          skill.toLowerCase().includes(query)
        );

        matchesSearch = titleMatch || domainMatch || locationMatch || modeMatch || companyMatch || skillsMatch;
      }

      return matchesDomain && matchesSearch;
    });
  }

  /**
   * Update visibility of state containers (Loading, Error, Empty, Content)
   */
  function updateUIStates(matchingCount = 0) {
    if (state.isLoading) {
      loadingState.hidden = false;
      errorState.hidden = true;
      emptyState.hidden = true;
      internshipGrid.hidden = true;
      resultsCount.textContent = 'Loading internships...';
      activeFilterTags.innerHTML = '';
      return;
    }

    loadingState.hidden = true;

    if (state.error) {
      errorState.hidden = false;
      emptyState.hidden = true;
      internshipGrid.hidden = true;
      errorMessage.textContent = state.error;
      resultsCount.textContent = 'Error loading records.';
      activeFilterTags.innerHTML = '';
      return;
    }

    errorState.hidden = true;

    if (matchingCount === 0) {
      emptyState.hidden = false;
      internshipGrid.hidden = true;
    } else {
      emptyState.hidden = true;
      internshipGrid.hidden = false;
    }
  }

  /**
   * Create an accessible HTML card for an internship record
   * @param {Object} item 
   * @returns {string} HTML markup
   */
  function createCardHTML(item) {
    const title = escapeHTML(item.title);
    const domain = escapeHTML(item.domain);
    const mode = escapeHTML(item.mode || 'Flexible');
    const location = escapeHTML(item.location || 'Not specified');
    const openings = item.openings ?? 1;
    const openingsText = openings === 1 ? '1 Opening' : `${openings} Openings`;
    const id = escapeHTML(item.id || 'N/A');
    
    // Normalize mode for CSS class
    const modeClass = mode.toLowerCase().replace(/\s+/g, '-');

    // Optional company name (only if present in dataset)
    const companyHTML = item.company 
      ? `<p class="card-company">${escapeHTML(item.company)}</p>` 
      : '';

    // Skills badges
    const skillsList = Array.isArray(item.skills) && item.skills.length > 0
      ? item.skills.map(skill => `<li><span class="skill-tag">${escapeHTML(skill)}</span></li>`).join('')
      : '<li><span class="skill-tag">General</span></li>';

    return `
      <li class="card-item">
        <article class="card" aria-labelledby="card-title-${id}">
          <div class="card-header">
            <div class="card-badges">
              <span class="badge badge-domain">${domain}</span>
              <span class="badge badge-mode badge-mode-${modeClass}">
                <span aria-hidden="true">&#9679;</span> ${mode}
              </span>
            </div>
            <h2 id="card-title-${id}" class="card-title">${title}</h2>
            ${companyHTML}
          </div>

          <div class="card-meta">
            <div class="meta-item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <span>${location}</span>
            </div>
            <div class="meta-item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <span class="meta-openings-badge">${openingsText}</span>
            </div>
          </div>

          <div class="card-skills">
            <h3 class="skills-title">Required Skills</h3>
            <ul class="skills-list" aria-label="Skills required for ${title}">
              ${skillsList}
            </ul>
          </div>

          <div class="card-footer">
            <span class="card-id" title="Internship Reference ID">Ref: ${id}</span>
          </div>
        </article>
      </li>
    `;
  }

  /**
   * Render filtered cards and announce status
   */
  function render() {
    const filtered = getFilteredInternships();
    const totalCount = state.internships.length;
    const matchCount = filtered.length;

    updateUIStates(matchCount);

    // Update active filter tags
    renderActiveFilterTags();

    // Screen reader accessible count status
    if (state.searchQuery || state.selectedDomain !== 'all') {
      resultsCount.innerHTML = `Showing <strong>${matchCount}</strong> of <strong>${totalCount}</strong> internships`;
    } else {
      resultsCount.innerHTML = `Showing all <strong>${totalCount}</strong> available internships`;
    }

    if (matchCount > 0) {
      internshipGrid.innerHTML = filtered.map(createCardHTML).join('');
    } else {
      internshipGrid.innerHTML = '';
    }

    // Toggle clear search button visibility
    clearSearchBtn.hidden = state.searchQuery.length === 0;
  }

  /**
   * Render active filter tags in metadata bar
   */
  function renderActiveFilterTags() {
    const tags = [];

    if (state.searchQuery.trim().length > 0) {
      tags.push(`Search: "${escapeHTML(state.searchQuery.trim())}"`);
    }

    if (state.selectedDomain !== 'all') {
      tags.push(`Domain: ${escapeHTML(state.selectedDomain)}`);
    }

    if (tags.length > 0) {
      activeFilterTags.innerHTML = tags
        .map(tag => `<span class="active-tag">${tag}</span>`)
        .join('');
    } else {
      activeFilterTags.innerHTML = '';
    }
  }

  /**
   * Reset all search and filter controls
   */
  function resetFilters() {
    state.searchQuery = '';
    state.selectedDomain = 'all';
    searchInput.value = '';
    domainFilter.value = 'all';
    render();
    searchInput.focus();
  }

  // Event Listeners
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    render();
  });

  clearSearchBtn.addEventListener('click', () => {
    state.searchQuery = '';
    searchInput.value = '';
    render();
    searchInput.focus();
  });

  domainFilter.addEventListener('change', (e) => {
    state.selectedDomain = e.target.value;
    render();
  });

  resetFiltersBtn.addEventListener('click', resetFilters);
  emptyResetBtn.addEventListener('click', resetFilters);
  retryBtn.addEventListener('click', loadInternships);

  // Initialize application on DOM ready
  document.addEventListener('DOMContentLoaded', loadInternships);
})();
