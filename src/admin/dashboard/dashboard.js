const supabaseClient = window.supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY
);

const bookingTableBody =
  document.getElementById("bookingTableBody");

const logoutButton =
  document.getElementById("logoutButton");

const refreshButton =
  document.getElementById("refreshButton");

const dashboardMessage =
  document.getElementById("dashboardMessage");

const deleteBookingModal =
  document.getElementById("deleteBookingModal");

const deleteBookingMessage =
  document.getElementById("deleteBookingMessage");

const keepBookingButton =
  document.getElementById("keepBookingButton");

const confirmDeleteButton =
  document.getElementById("confirmDeleteButton");

let currentBookings = [];
let pendingDeleteBookingId = null;
let deleteInProgress = false;
let deleteTriggerElement = null;
let dashboardMessageTimeout = null;

initializeDashboard();

async function initializeDashboard() {
  const {
    data: { session },
    error
  } = await supabaseClient.auth.getSession();

  if (error || !session) {
    redirectToLogin();
    return;
  }

  const { data: adminProfile } = await supabaseClient
    .from("admin_profiles")
    .select("full_name, role")
    .eq("id", session.user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (!adminProfile) {
    await supabaseClient.auth.signOut();
    redirectToLogin();
    return;
  }

  document.getElementById("adminWelcome").textContent =
    `Welcome, ${adminProfile.full_name}`;

  await loadBookings();
}

async function loadBookings() {
  bookingTableBody.innerHTML = `
    <tr>
      <td colspan="7" class="empty-state">
        Loading bookings...
      </td>
    </tr>
  `;

  const { data, error } = await supabaseClient
    .from("bookings")
    .select(`
      id,
      customer_name,
      callback_number,
      service_type,
      booking_date,
      start_time,
      end_time,
      status,
      created_at
    `)
    .order("booking_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    console.error(error);

    bookingTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state error-text">
          Could not load bookings.
        </td>
      </tr>
    `;

    return;
  }

  currentBookings = data || [];

  renderBookings();
  updateStats();
}

function renderBookings() {
  if (!currentBookings.length) {
    bookingTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">
          No bookings yet.
        </td>
      </tr>
    `;

    return;
  }

  bookingTableBody.innerHTML =
    currentBookings
      .map((booking) => {

        const statusClass =
          booking.status === "confirmed"
            ? "confirmed"
            : "cancelled";

        return `
          <tr>

            <td>
              <strong>
                ${escapeHtml(booking.customer_name)}
              </strong>
            </td>

            <td>
              ${escapeHtml(booking.callback_number)}
            </td>

            <td>
              ${formatService(booking.service_type)}
            </td>

            <td>
              ${formatDate(booking.booking_date)}
            </td>

            <td>
              ${formatTime(booking.start_time)}
              –
              ${formatTime(booking.end_time)}
            </td>

            <td>
              <span class="status-pill ${statusClass}">
                ${booking.status}
              </span>
            </td>

            <td>
              <div class="booking-actions">
                ${
                  booking.status === "confirmed"
                    ? `
                      <button
                        type="button"
                        class="cancel-booking-btn"
                        onclick="cancelBooking('${escapeHtml(booking.id)}')"
                      >
                        Cancel
                      </button>
                    `
                    : ""
                }

                <button
                  type="button"
                  class="delete-booking-btn"
                  data-booking-id="${escapeHtml(booking.id)}"
                  aria-label="Delete booking for ${escapeHtml(booking.customer_name)}"
                >
                  Delete
                </button>
              </div>
            </td>

          </tr>
        `;
      })
      .join("");
}

function updateStats() {
  const today =
    new Date().toISOString().split("T")[0];

  const confirmed =
    currentBookings.filter(
      booking => booking.status === "confirmed"
    );

  const todayBookings =
    confirmed.filter(
      booking => booking.booking_date === today
    );

  const upcoming =
    confirmed.filter(
      booking => booking.booking_date > today
    );

  document.getElementById("todayCount").textContent =
    todayBookings.length;

  document.getElementById("upcomingCount").textContent =
    upcoming.length;

  document.getElementById("confirmedCount").textContent =
    confirmed.length;

  document.getElementById("totalCount").textContent =
    currentBookings.length;
}

async function cancelBooking(bookingId) {
  const confirmed =
    window.confirm(
      "Are you sure you want to cancel this booking?"
    );

  if (!confirmed) {
    return;
  }

  const { error } = await supabaseClient
    .from("bookings")
    .update({
      status: "cancelled"
    })
    .eq("id", bookingId);

  if (error) {
    console.error(error);

    alert("Unable to cancel this booking.");
    return;
  }

  await loadBookings();
}

function openDeleteBookingModal(bookingId, triggerElement) {
  const booking = currentBookings.find(
    item => String(item.id) === String(bookingId)
  );

  if (!booking || deleteInProgress) {
    return;
  }

  pendingDeleteBookingId = booking.id;
  deleteTriggerElement = triggerElement;

  deleteBookingMessage.textContent =
    `This will permanently delete the booking for ${booking.customer_name} ` +
    `on ${formatLongDate(booking.booking_date)} from ` +
    `${formatTime(booking.start_time)} to ${formatTime(booking.end_time)}. ` +
    "This action cannot be undone.";

  deleteBookingModal.hidden = false;
  document.body.classList.add("modal-open");
  keepBookingButton.focus();
}

function closeDeleteBookingModal({ restoreFocus = true } = {}) {
  if (deleteInProgress) {
    return;
  }

  deleteBookingModal.hidden = true;
  document.body.classList.remove("modal-open");
  pendingDeleteBookingId = null;
  deleteBookingMessage.textContent = "";

  if (restoreFocus && deleteTriggerElement?.isConnected) {
    deleteTriggerElement.focus();
  }

  deleteTriggerElement = null;
}

async function deleteBookingPermanently() {
  if (!pendingDeleteBookingId || deleteInProgress) {
    return;
  }

  const bookingId = pendingDeleteBookingId;
  deleteInProgress = true;
  confirmDeleteButton.disabled = true;
  keepBookingButton.disabled = true;
  confirmDeleteButton.textContent = "Deleting...";

  try {
    const { error, count } = await supabaseClient
      .from("bookings")
      .delete({ count: "exact" })
      .eq("id", bookingId);

    if (error || count !== 1) {
      console.error("BOOKING_DELETE_FAILED", {
        code: error?.code || "ROW_NOT_DELETED",
        status: error?.status || null,
        message: error?.message || "Delete affected no booking row"
      });

      showDashboardMessage(
        "Unable to delete this booking. Please try again.",
        "error"
      );

      return;
    }

    deleteInProgress = false;
    closeDeleteBookingModal({ restoreFocus: false });

    currentBookings = currentBookings.filter(
      booking => String(booking.id) !== String(bookingId)
    );

    renderBookings();
    updateStats();
    showDashboardMessage("Booking deleted.", "success");
    refreshButton.focus();
  } catch (error) {
    console.error("BOOKING_DELETE_FAILED", {
      category: error instanceof Error ? error.name : "UnknownError"
    });

    showDashboardMessage(
      "Unable to delete this booking. Please try again.",
      "error"
    );
  } finally {
    deleteInProgress = false;
    confirmDeleteButton.disabled = false;
    keepBookingButton.disabled = false;
    confirmDeleteButton.textContent = "Delete Permanently";
  }
}

function showDashboardMessage(message, type) {
  window.clearTimeout(dashboardMessageTimeout);
  dashboardMessage.textContent = message;
  dashboardMessage.className = `dashboard-message ${type}`;
  dashboardMessage.hidden = false;

  dashboardMessageTimeout = window.setTimeout(() => {
    dashboardMessage.hidden = true;
  }, 5000);
}

refreshButton.addEventListener(
  "click",
  loadBookings
);

logoutButton.addEventListener(
  "click",
  async () => {

    await supabaseClient.auth.signOut();

    redirectToLogin();
  }
);

bookingTableBody.addEventListener("click", event => {
  const deleteButton = event.target.closest(".delete-booking-btn");

  if (!deleteButton) {
    return;
  }

  openDeleteBookingModal(
    deleteButton.dataset.bookingId,
    deleteButton
  );
});

keepBookingButton.addEventListener("click", () => {
  closeDeleteBookingModal();
});

confirmDeleteButton.addEventListener(
  "click",
  deleteBookingPermanently
);

deleteBookingModal.addEventListener("click", event => {
  if (event.target === deleteBookingModal) {
    closeDeleteBookingModal();
  }
});

deleteBookingModal.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeDeleteBookingModal();
    return;
  }

  if (event.key !== "Tab") {
    return;
  }

  const focusableElements = [
    keepBookingButton,
    confirmDeleteButton
  ].filter(element => !element.disabled);

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
});

function redirectToLogin() {
  window.location.href = "/admin/login/";
}

function formatDate(dateString) {
  const date =
    new Date(`${dateString}T00:00:00`);

  return date.toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric"
    }
  );
}

function formatLongDate(dateString) {
  const date =
    new Date(`${dateString}T00:00:00`);

  return date.toLocaleDateString(
    "en-US",
    {
      month: "long",
      day: "numeric",
      year: "numeric"
    }
  );
}

function formatTime(timeString) {
  const [hourString, minuteString] =
    timeString.split(":");

  let hour = Number(hourString);

  const suffix =
    hour >= 12 ? "PM" : "AM";

  hour = hour % 12 || 12;

  return `${hour}:${minuteString} ${suffix}`;
}

function formatService(service) {
  if (!service) {
    return "—";
  }

  return escapeHtml(
    service
      .replaceAll("_", " ")
      .replace(/\b\w/g, char => char.toUpperCase())
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
